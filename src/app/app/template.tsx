/** Re-monté à chaque navigation : déclenche la transition d'entrée de la page (voir `.page-enter`). */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
