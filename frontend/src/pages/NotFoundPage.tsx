import { Link } from "react-router-dom";
import { Panel } from "../shared/ui/Panel";

export default function NotFoundPage() {
  return (
    <Panel title="Page not found">
      <p>This address does not match a workspace page.</p>
      <Link className="button" to="/projects">
        Back to projects
      </Link>
    </Panel>
  );
}
