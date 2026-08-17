// NodeDR POS — MSIX foreground app.
//
// This replaces the old open-pos.exe stub (which started two Windows
// Services and handed the URL to the shop's default browser — see git
// history for open-pos.cs.template). This app now owns the whole POS UI
// lifecycle directly and has no browser-tab dependency:
//
//   1. Spawn the backend and frontend as plain child processes of THIS
//      process (no Windows Service, no SCM registration) — started when
//      the user opens the app, stopped when they close it.
//   2. Wait for the frontend's port to accept a connection.
//   3. Show a WebView2-hosted window navigated at http://localhost:<port>,
//      so the POS renders inside its own app window, not a browser tab.
//
// This is why the MSIX manifest only declares the `runFullTrust`
// capability now, not `packagedServices`/`localSystemServices` — there is
// no packaged Windows Service left to declare. The trade-off (a deliberate
// choice, not an oversight): the backend/frontend only run while this app
// is open, so — unlike the EXE/Docker installs, which stay reachable from
// other devices on the shop LAN — this Store build is single-machine,
// foreground-only. Both child processes bind to 127.0.0.1 only (see the
// env blocks below) and no firewall rules are opened, matching that scope.
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NodedrPos.Launcher
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            // Single-instance guard: without this, clicking the Start Menu
            // tile a second time while the app is already open would spawn a
            // second backend/frontend pair trying to bind the same ports —
            // the second pair crashes on EADDRINUSE, and the user sees a
            // confusing error instead of just their already-open POS.
            bool createdNew;
            using (var singleInstance = new Mutex(true, "Local\\NodeDRPOS_SingleInstance", out createdNew))
            {
                if (!createdNew)
                {
                    MessageBox.Show(
                        "Nodedr POS is already open.",
                        "Nodedr POS",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information);
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
            }
        }
    }

    internal sealed class MainForm : Form
    {
        // Token-substituted by build-msix.ps1, same pattern the old
        // open-pos.cs.template used.
        private const int BackendPort = @BACKEND_PORT@;
        private const int FrontendPort = @FRONTEND_PORT@;
        private const int MaxWaitAttempts = 45;

        private readonly Label _statusLabel;
        private WebView2 _webView;
        private JobObject _jobObject;
        private Process _backendProcess;
        private Process _frontendProcess;
        private StreamWriter _launcherLog;

        public MainForm()
        {
            Text = "Nodedr POS";
            Width = 1280;
            Height = 800;
            StartPosition = FormStartPosition.CenterScreen;

            _statusLabel = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = System.Drawing.ContentAlignment.MiddleCenter,
                Font = new System.Drawing.Font("Segoe UI", 14F),
                Text = "Starting Nodedr POS…",
            };
            Controls.Add(_statusLabel);

            Load += async (_, __) => await StartAsync();
            FormClosing += (_, __) => ShutDownChildProcesses();
        }

        // Logs the launcher's own lifecycle stages — separate from
        // backend.log/frontend.log (those are the child processes' own
        // output). Exists so a startup failure that happens INSIDE this exe
        // (WebView2 init, process spawn) is diagnosable from
        // C:\ProgramData\NodeDRPOS\logs rather than only visible as a label
        // on a window the shopkeeper may have already closed. Also gives an
        // external test (CI, WACK) a real "did WebView2 actually come up"
        // signal to poll for — the HTTP health check alone only proves the
        // backend child process is up, not that this exe's own WebView2
        // control initialized (this gap is exactly how the AnyCPU/
        // Prefer32Bit bitness bug shipped past CI in the first place: see
        // OpenPos.csproj's comment).
        private void Log(string message)
        {
            try { _launcherLog?.WriteLine(DateTime.Now.ToString("s") + "  " + message); } catch { /* best-effort */ }
        }

        private async Task StartAsync()
        {
            var dataDir = @"C:\ProgramData\NodeDRPOS";
            try
            {
                var baseDir = AppDomain.CurrentDomain.BaseDirectory;
                Directory.CreateDirectory(dataDir);
                Directory.CreateDirectory(Path.Combine(dataDir, "logs"));
                _launcherLog = new StreamWriter(Path.Combine(dataDir, "logs", "launcher.log"), append: true) { AutoFlush = true };
                Log("Launcher starting");

                // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: both child processes die
                // the instant this process exits or is killed — including a
                // crash, not just a clean window close — so a backend/frontend
                // pair never survives orphaned after the app is gone. Same
                // technique Electron uses on Windows for exactly this reason.
                _jobObject = new JobObject();

                _backendProcess = StartChild(
                    exe: Path.Combine(baseDir, "runtime", "node.exe"),
                    args: "\"" + Path.Combine(baseDir, "msix-wrappers", "backend-service.js") + "\"",
                    workingDir: Path.Combine(baseDir, "backend"),
                    logName: "backend",
                    dataDir: dataDir,
                    env: new System.Collections.Generic.Dictionary<string, string>
                    {
                        ["PORT"] = BackendPort.ToString(),
                        ["NODE_ENV"] = "production",
                        ["FRONTEND_ORIGIN"] = "http://localhost:" + FrontendPort,
                        ["COOKIE_SECURE"] = "false",
                        // Forward slashes deliberately — see the equivalent
                        // comment in packaging/windows/service/nodedr-pos-backend.xml.
                        ["DATABASE_URL"] = "file:C:/ProgramData/NodeDRPOS/pos.db",
                        ["CHECKPOINT_DISABLE"] = "1",
                        ["PRISMA_HIDE_UPDATE_MESSAGE"] = "1",
                    });
                _jobObject.AddProcess(_backendProcess);
                Log("Backend child process started (pid=" + _backendProcess.Id + ")");

                _frontendProcess = StartChild(
                    exe: Path.Combine(baseDir, "runtime", "node.exe"),
                    args: "\"" + Path.Combine(baseDir, "frontend", "server.js") + "\"",
                    workingDir: Path.Combine(baseDir, "frontend"),
                    logName: "frontend",
                    dataDir: dataDir,
                    env: new System.Collections.Generic.Dictionary<string, string>
                    {
                        ["PORT"] = FrontendPort.ToString(),
                        ["NODE_ENV"] = "production",
                        // Loopback only, deliberately — unlike the EXE/Docker
                        // installs this build has no firewall rule opening the
                        // port to the LAN. See this file's header comment.
                        ["HOSTNAME"] = "127.0.0.1",
                        ["NEXT_TELEMETRY_DISABLED"] = "1",
                    });
                _jobObject.AddProcess(_frontendProcess);
                Log("Frontend child process started (pid=" + _frontendProcess.Id + ")");

                var ready = await WaitForPortAsync(FrontendPort, MaxWaitAttempts);
                if (!ready)
                {
                    Log("STARTUP FAILED: frontend port " + FrontendPort + " never accepted a connection within " + MaxWaitAttempts + "s");
                    _statusLabel.Text =
                        "Nodedr POS didn't start in time.\n\n" +
                        "Check C:\\ProgramData\\NodeDRPOS\\logs\\backend.log and frontend.log for errors, then try again.";
                    return;
                }
                Log("Frontend port ready");

                await InitializeWebViewAsync();
            }
            catch (Exception ex)
            {
                // BadImageFormatException (HRESULT 0x8007000B, "An attempt was
                // made to load a program with an incorrect format") is a
                // distinct, actionable failure mode — an architecture mismatch
                // between this exe and a native DLL it depends on (this is
                // exactly the bug OpenPos.csproj's PlatformTarget/Prefer32Bit
                // pinning now prevents, and build-msix.ps1's architecture
                // guardrail catches at build time — but log it distinctly in
                // case it ever recurs some other way, e.g. a future native
                // dependency added without the same care). Full exception
                // detail always goes to the log for diagnostics; the on-screen
                // message stays clean for the shopkeeper, per the "log the
                // technical cause, show a friendly message" split.
                Log("STARTUP FAILED: " + ex.GetType().FullName + ": " + ex.Message + "\n" + ex.StackTrace);
                if (ex is BadImageFormatException)
                {
                    _statusLabel.Text =
                        "Nodedr POS couldn't start a required component (architecture mismatch).\n\n" +
                        "Please restart the application. If the problem continues, contact support with the details in " +
                        "C:\\ProgramData\\NodeDRPOS\\logs\\launcher.log.";
                }
                else
                {
                    _statusLabel.Text =
                        "Nodedr POS couldn't start a required component.\n\n" +
                        "Please restart the application. If the problem continues, contact support with the details in " +
                        "C:\\ProgramData\\NodeDRPOS\\logs\\launcher.log.";
                }
            }
        }

        private async Task InitializeWebViewAsync()
        {
            // WebView2's default user-data-folder location is next to the exe,
            // which under MSIX is the package's read-only install root — that
            // fails outright. Point it at the same writable ProgramData root
            // the app already uses for its database/logs/secret (same reason
            // packaging/windows/README.md's junction-trick section gives for
            // the backend's data files: the install root can't be written to
            // at runtime).
            var userDataFolder = @"C:\ProgramData\NodeDRPOS\webview2-data";
            Directory.CreateDirectory(userDataFolder);

            CoreWebView2Environment environment;
            try
            {
                environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder);
                Log("WebView2 environment created");
            }
            catch (WebView2RuntimeNotFoundException)
            {
                Log("STARTUP FAILED: WebView2RuntimeNotFoundException — Edge WebView2 Runtime not installed");
                _statusLabel.Text =
                    "Nodedr POS needs the Microsoft Edge WebView2 Runtime, which is not installed.\n\n" +
                    "It ships with Windows 11 and current Windows 10 by default. If missing, install it " +
                    "from https://developer.microsoft.com/microsoft-edge/webview2/ and reopen Nodedr POS.";
                return;
            }

            _webView = new WebView2 { Dock = DockStyle.Fill };
            Controls.Add(_webView);
            await _webView.EnsureCoreWebView2Async(environment);
            _webView.BringToFront();
            _statusLabel.Visible = false;

            _webView.CoreWebView2.Navigate("http://localhost:" + FrontendPort);
            // This is the definitive "the launcher itself came up correctly"
            // signal — see the Log() method's comment. build-windows-msix.yml
            // polls for this exact line instead of only the backend's HTTP
            // health check, which would stay blind to a WebView2-layer
            // failure (this app catches that exception and swaps a label
            // instead of crashing the process — see StartAsync's catch block).
            Log("WebView2 navigated to http://localhost:" + FrontendPort + " — READY");
        }

        private static Process StartChild(
            string exe,
            string args,
            string workingDir,
            string logName,
            string dataDir,
            System.Collections.Generic.Dictionary<string, string> env)
        {
            var logPath = Path.Combine(dataDir, "logs", logName + ".log");
            var psi = new ProcessStartInfo
            {
                FileName = exe,
                Arguments = args,
                WorkingDirectory = workingDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            foreach (var kv in env)
            {
                psi.EnvironmentVariables[kv.Key] = kv.Value;
            }

            var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            // Simple append-mode log redirection — good enough for a
            // single-machine till, matches the plain-file logging the WinSW
            // services used to produce (no rotation here; ProgramData\logs
            // isn't expected to grow unbounded within a single power-on
            // session the way an always-on service's log would).
            var logWriter = new StreamWriter(logPath, append: true) { AutoFlush = true };
            process.OutputDataReceived += (_, e) => { if (e.Data != null) logWriter.WriteLine(e.Data); };
            process.ErrorDataReceived += (_, e) => { if (e.Data != null) logWriter.WriteLine(e.Data); };
            process.Exited += (_, __) => logWriter.Dispose();

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            return process;
        }

        private static async Task<bool> WaitForPortAsync(int port, int maxAttempts)
        {
            for (var i = 0; i < maxAttempts; i++)
            {
                try
                {
                    using (var client = new TcpClient())
                    {
                        var connectTask = client.ConnectAsync("127.0.0.1", port);
                        if (await Task.WhenAny(connectTask, Task.Delay(1000)) == connectTask && client.Connected)
                        {
                            return true;
                        }
                    }
                }
                catch
                {
                    // Not up yet — keep polling until maxAttempts.
                }
                await Task.Delay(1000);
            }
            return false;
        }

        private void ShutDownChildProcesses()
        {
            Log("Shutting down");
            // Disposing the job object kills every process assigned to it
            // (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) — this is the primary
            // cleanup path and covers both processes plus any children they
            // spawn. The explicit Kill() calls below are a best-effort
            // belt-and-suspenders for the (should be impossible) case where
            // job-object assignment itself failed.
            try { _jobObject?.Dispose(); } catch { /* best-effort */ }
            try { if (_backendProcess != null && !_backendProcess.HasExited) _backendProcess.Kill(); } catch { }
            try { if (_frontendProcess != null && !_frontendProcess.HasExited) _frontendProcess.Kill(); } catch { }
            try { _launcherLog?.Dispose(); } catch { /* best-effort */ }
        }
    }

    /// <summary>
    /// Thin wrapper around the Win32 Job Object APIs, configured with
    /// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE so every process assigned to it is
    /// forcibly terminated the moment the job handle closes (including on an
    /// unhandled crash of this app, not only a clean exit) — the standard
    /// Windows mechanism for "kill the whole child-process tree when the
    /// parent goes away", since a plain Process.Kill() on the direct children
    /// alone would not catch grandchildren.
    /// </summary>
    internal sealed class JobObject : IDisposable
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(
            IntPtr hJob, JobObjectInfoType infoType, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION lpJobObjectInfo, uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        private enum JobObjectInfoType
        {
            ExtendedLimitInformation = 9,
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

        private readonly IntPtr _handle;

        public JobObject()
        {
            _handle = CreateJobObject(IntPtr.Zero, null);
            if (_handle == IntPtr.Zero)
            {
                throw new InvalidOperationException("CreateJobObject failed: " + Marshal.GetLastWin32Error());
            }

            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION
            {
                BasicLimitInformation = new JOBOBJECT_BASIC_LIMIT_INFORMATION
                {
                    LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                },
            };
            var length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            var ok = SetInformationJobObject(_handle, JobObjectInfoType.ExtendedLimitInformation, ref info, (uint)length);
            if (!ok)
            {
                throw new InvalidOperationException("SetInformationJobObject failed: " + Marshal.GetLastWin32Error());
            }
        }

        public void AddProcess(Process process)
        {
            if (!AssignProcessToJobObject(_handle, process.Handle))
            {
                throw new InvalidOperationException("AssignProcessToJobObject failed: " + Marshal.GetLastWin32Error());
            }
        }

        public void Dispose()
        {
            CloseHandle(_handle);
        }
    }
}
