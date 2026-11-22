# NodeDR POS for Windows (Microsoft Store edition)

Install **Nodedr POS** from the Microsoft Store, open it from the Start menu, and it runs in its own window. Nothing else to install: no Docker, Node.js, database, browser setup, PowerShell or ports. It works offline.

## Store edition vs Docker / self-hosted

| | Microsoft Store edition | Docker Compose / CasaOS |
|---|---|---|
| Install | Store → Install | `docker compose up` / CasaOS app |
| Runs | One window on this PC | Server; open in any browser |
| Other devices (tablet, phone) on your network | **No.** This PC only, by design | Yes |
| Updates | Microsoft Store (automatic) | In-app **Update now** (Docker) |
| Data | This PC, inside the app's package folder | Docker volume |
| Needs admin / firewall change | No | Depends |

The Store edition listens only on `127.0.0.1`, so Windows Firewall shows no prompt and nothing on your network can reach it. If you need other devices to use the POS, use the Docker or CasaOS edition.

The two editions never share files. Installing the Store app does not touch a Docker installation, and the reverse.

## Where your data lives

```
%LOCALAPPDATA%\Packages\<package family name>\LocalState\NodeDRPOS\
    pos.db          your database
    backups\        automatic copies taken before every database upgrade (last 5 kept)
    recovered\      anything set aside by a recovery, never deleted automatically
    logs\           shell.log, backend.log, frontend.log, migration.log
    signatures\ product-images\   uploaded files
```

The exact path is shown in **Help → Diagnostics**, and **File → Open data folder** opens it.

> **Uninstalling the app from Windows deletes this folder.** Always use **File → Back up data…** first and keep the `.zip` somewhere safe (another drive, cloud storage, a USB stick). Updates from the Store keep your data.

## Backup and restore

- **File → Back up data…** saves a single `.zip` (database + signatures + product images). It never contains your sign-in secret. It is safe to run while you are working.
- **File → Import or restore data…** restores a backup. It always shows what is inside first, keeps a safety copy of your current data (in `backups\`), and refuses data created by a *newer* version of the app.
- Before every database upgrade the app copies your database to `backups\` and checks the copy. If the upgrade fails or is interrupted, your previous data is put back automatically and the app tells you.

## Moving from the Docker version

Importing never changes your Docker installation: it only reads from it.

1. **Easiest:** **File → Import or restore data… → Find my Docker installation** (needs Docker Desktop running).
2. **Or copy the data out yourself** (PowerShell), then choose **A data folder…**:

   ```powershell
   docker cp nodedr-pos-backend:/app/data C:\nodedr-docker-data
   ```

   (`docker compose cp backend:/app/data .\nodedr-docker-data` works too.) The folder must contain `pos.db`.
3. Check the summary (shop name, products, invoices), confirm, and the app restarts with your data. An older database is upgraded automatically, with a backup first.

Staff sign-ins, products, customers, invoices and settings come across. Everyone has to sign in again once.

If you used an earlier Store version of NodeDR POS, the app offers to import its data the first time it starts. The old files are left where they are.

## If it does not start

The window shows what went wrong and offers **Try again**, **Copy support report**, **Open logs folder**, and for a damaged database **Restore from a backup…**. The support report contains versions, paths and recent log lines. It never contains passwords, cookies or business data.

Common causes:
- *"The database is in use"*: another NodeDR POS window is open (check Task Manager), or security software is scanning the file. Close it and try again.
- *"This data is from a newer version"*: update the app from the Store; the database is untouched.
- *Port conflicts*: the app picks a free local port automatically and never connects to anything it did not start.

## Hardware

- **USB / Bluetooth barcode scanner** (keyboard mode): works without focusing a field. See [SCANNER.md](SCANNER.md).
- **Camera scanning**: the first time, Windows asks for camera permission (Settings → Privacy & security → Camera → allow desktop apps).
- **Receipts**: *Print* opens the Windows print dialog.
