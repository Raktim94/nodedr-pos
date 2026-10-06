// A template (unlike a layout) re-mounts on every navigation, so the new
// page's content gets a short rise-in while the sidebar and top bar — which
// live in the layout above — stay put.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
