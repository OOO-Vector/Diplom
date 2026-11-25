import { SidebarSearch } from "./SidebarSearch";
import { useId, useState, type FormEvent } from "react";
import "./Sidebar.css";
import "./ChatSidebar.css";

type ChatSidebarProps = {
  chats?: readonly { id: string; name: string }[];
  activeChatId?: string;
  initiallyCollapsed?: boolean;
  projectDocsActive?: boolean;
  onNewChat?: (name: string) => void;
  onSelectChat?: (id: string) => void;
  onProjectDocsClick?: () => void;
};

export function ChatSidebar({
  chats = [],
  activeChatId,
  initiallyCollapsed = false,
  projectDocsActive,
  onNewChat,
  onSelectChat,
  onProjectDocsClick,
}: ChatSidebarProps) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [draftName, setDraftName] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [docsPressed, setDocsPressed] = useState(false);
  const contentId = useId();
  const query = search.trim().toLowerCase();
  const visibleChats = chats.filter(({ name }) =>
    name.toLowerCase().includes(query),
  );
  const docsActive = projectDocsActive ?? docsPressed;

  function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draftName === null || !onNewChat) return;
    onNewChat(draftName.trim());
    setDraftName(null);
    setSearch("");
  }

  return (
    <aside
      className="project-sidebar chat-sidebar"
      aria-label="Chats"
      data-collapsed={collapsed}
    >
      <button
        className="project-sidebar__toggle"
        type="button"
        aria-label={
          collapsed ? "Expand chats sidebar" : "Collapse chats sidebar"
        }
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onClick={() => setCollapsed((current) => !current)}
      >
        <span aria-hidden="true">{collapsed ? ">" : "<"}</span>
      </button>
      <div id={contentId} hidden={collapsed}>
        <h2 className="project-sidebar__title">Chats</h2>
        <div className="project-sidebar__actions chat-sidebar__actions">
          {draftName === null || !onNewChat ? (
            <button
              className="project-sidebar__new"
              type="button"
              onClick={() => setDraftName("")}
              disabled={!onNewChat}
            >
              <span className="project-sidebar__plus" aria-hidden="true" />
              New chat
            </button>
          ) : (
            <form className="project-sidebar__create" onSubmit={submitChat}>
              <button
                type="submit"
                className="project-sidebar__new"
                aria-label="Create chat"
              >
                <span className="project-sidebar__plus" aria-hidden="true" />
              </button>
              <input
                aria-label="Chat name"
                autoFocus
                maxLength={150}
                placeholder="New chat"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setDraftName(null);
                }}
              />
            </form>
          )}
          <SidebarSearch
            label="Search dialogues"
            value={search}
            onChange={setSearch}
          />
          <button
            className="chat-sidebar__docs"
            type="button"
            aria-pressed={docsActive}
            onClick={() => {
              if (projectDocsActive === undefined)
                setDocsPressed((current) => !current);
              onProjectDocsClick?.();
            }}
          >
            <svg
              className="chat-sidebar__docs-icon"
              viewBox="0 0 37 48"
              aria-hidden="true"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M0 0h37v48H0zM4 6h29v4H4zM4 14h29v4H4zM4 22h29v4H4zM4 30h29v4H4zM4 38h29v4H4z"
              />
            </svg>
            Project docs
          </button>
        </div>
        <nav
          className="project-sidebar__projects chat-sidebar__list"
          aria-label="Dialogues"
        >
          <ul>
            {visibleChats.map(({ id, name }) => (
              <li key={id}>
                <button
                  type="button"
                  aria-current={id === activeChatId ? "true" : undefined}
                  onClick={() => onSelectChat?.(id)}
                  disabled={!onSelectChat}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </aside>
  );
}
