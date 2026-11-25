import { useWorkspace } from "../features/projects/model/workspaceContext";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import {
  listProjectDocuments,
  projectDocumentId,
  projectDocumentsKey,
  setProjectDocumentEnabled,
  storeProjectDocuments,
} from "../features/projects/model/projectDocuments";
import { ChatSidebar } from "../widgets/layout/ChatSidebar";
import { workspaceKey } from "../features/account/accountWorkspace";
import { recordAnswerDurations } from "../features/projects/model/projectAnalytics";
import "./ProjectChatPage.css";

type Draft = { text: string; documents: File[] };
type Reply = {
  startedAt: number;
  elapsed: number;
  state: "generating" | "complete" | "stopped";
  contextDocumentIds: string[];
};
type Message = Draft & { reply: Reply };
type Chat = {
  id: string;
  name: string;
  messages: Message[];
  draft: Draft;
  editDraft: Draft | null;
};

function demoReply({ contextDocumentIds }: Reply) {
  const count = contextDocumentIds.length;
  return `Demo response. I received your message. ${count} document${count === 1 ? "" : "s"} selected for context. The AI service is not connected yet.`;
}
const replyDelay = 500;

function updateReply(chat: Chat, now: number, stop = false): Chat {
  const last = chat.messages.at(-1);
  if (!last || last.reply.state !== "generating") return chat;

  const replyDuration = replyDelay + demoReply(last.reply).length * 35;
  const elapsed = Math.min(now - last.reply.startedAt, replyDuration);
  const state =
    elapsed >= replyDuration ? "complete" : stop ? "stopped" : "generating";
  return {
    ...chat,
    messages: [
      ...chat.messages.slice(0, -1),
      { ...last, reply: { ...last.reply, elapsed, state } },
    ],
  };
}

function createChat(number: number, name?: string): Chat {
  return {
    id: String(number),
    name: name || `New chat ${number}`,
    messages: [],
    draft: { text: "", documents: [] },
    editDraft: null,
  };
}

export default function ProjectChatPage() {
  const { archived } = useWorkspace();
  const { projectId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const docsOpen = searchParams.get("view") === "docs";
  const queryClient = useQueryClient();
  const documentsKey = projectDocumentsKey(projectId);
  const documents = useQuery({
    queryKey: documentsKey,
    queryFn: ({ signal }) => listProjectDocuments(projectId, signal),
    retry: false,
  });
  const chatCountKey = workspaceKey(`team-ai.chat-count:${projectId}`);
  const chatNamesKey = workspaceKey(`team-ai.chat-names:${projectId}`);
  const [chats, setChats] = useState(() => {
    let count = 1;
    let names: unknown;
    try {
      names = JSON.parse(localStorage.getItem(chatNamesKey) ?? "null");
    } catch {
      names = null;
    }
    try {
      const stored = Number(localStorage.getItem(chatCountKey));
      if (Number.isSafeInteger(stored) && stored > 0) count = stored;
    } catch {
      // The first chat still works when browser storage is unavailable.
    }
    return Array.from({ length: count }, (_, index) => {
      const number = count - index;
      const name: unknown = Array.isArray(names)
        ? names[number - 1]
        : undefined;
      return createChat(number, typeof name === "string" ? name : undefined);
    });
  });
  const [activeId, setActiveId] = useState(chats[0]?.id ?? "1");
  const [documentError, setDocumentError] = useState("");
  const [updatingDocument, setUpdatingDocument] = useState(false);
  const chat = chats.find(({ id }) => id === activeId) ?? chats[0]!;
  const draft = chat.editDraft ?? chat.draft;
  const latestReply = chat.messages.at(-1)?.reply;
  const generating = latestReply?.state === "generating";
  const hasPendingReply = chats.some(
    (entry) => entry.messages.at(-1)?.reply.state === "generating",
  );
  const composer = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const followHistory = useRef(true);
  const lifecycle = useRef<AbortController>();
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    return () => controller.abort();
  }, []);
  const measuredReplies = useRef(new WeakSet<Reply>());
  const projectDocuments = documents.data ?? [];

  useEffect(() => {
    const completed: Reply[] = [];
    for (const entry of chats) {
      const reply = entry.messages.at(-1)?.reply;
      if (reply?.state !== "complete" || measuredReplies.current.has(reply))
        continue;
      measuredReplies.current.add(reply);
      completed.push(reply);
    }
    completed.sort((a, b) => a.startedAt + a.elapsed - b.startedAt - b.elapsed);
    recordAnswerDurations(
      projectId,
      completed.map(({ elapsed }) => elapsed),
    );
  }, [chats, projectId]);

  function showDocs(show: boolean) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (show) next.set("view", "docs");
      else next.delete("view");
      return next;
    });
  }

  function replyFor(files: readonly File[], startedAt: number): Reply {
    const ids = new Set(
      projectDocuments
        .filter((document) => document.enabled)
        .map(({ id }) => id),
    );
    for (const file of files) {
      const id = projectDocumentId(projectId, chat.id, file);
      if (
        !projectDocuments.some(
          (document) => document.id === id && !document.enabled,
        )
      )
        ids.add(id);
    }
    return {
      startedAt,
      elapsed: 0,
      state: "generating",
      contextDocumentIds: [...ids],
    };
  }

  async function saveAttachments(files: readonly File[]) {
    const signal = lifecycle.current?.signal;
    if (archived || !files.length || signal?.aborted) return;
    try {
      await storeProjectDocuments(projectId, chat.id, files, signal);
      if (signal?.aborted) return;
      await queryClient.invalidateQueries({
        queryKey: documentsKey,
      });
    } catch {
      if (!signal?.aborted)
        setDocumentError("Could not save attachments to Project docs.");
    }
  }

  async function toggleDocument(id: string, enabled: boolean) {
    const signal = lifecycle.current?.signal;
    if (archived || signal?.aborted) return;
    setUpdatingDocument(true);
    setDocumentError("");
    try {
      const updated = await setProjectDocumentEnabled(id, enabled, signal);
      if (signal?.aborted) return;
      queryClient.setQueryData<typeof documents.data>(documentsKey, (current) =>
        current?.map((document) => (document.id === id ? updated : document)),
      );
    } catch {
      if (!signal?.aborted)
        setDocumentError(
          "Could not update document context. Please try again.",
        );
    } finally {
      if (!signal?.aborted) setUpdatingDocument(false);
    }
  }

  useEffect(() => {
    if (archived || !hasPendingReply) return;
    const timer = window.setInterval(() => {
      const now = performance.now();
      setChats((current) => current.map((entry) => updateReply(entry, now)));
    }, 100);
    return () => window.clearInterval(timer);
  }, [archived, hasPendingReply]);

  useLayoutEffect(() => {
    const field = composer.current;
    if (!field) return;
    function resize() {
      if (!field) return;
      field.style.blockSize = "auto";
      field.style.blockSize = `${field.scrollHeight}px`;
    }
    resize();
    if (typeof ResizeObserver === "undefined") return;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return;
      width = field.clientWidth;
      resize();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [draft.text, docsOpen]);

  useLayoutEffect(() => {
    const log = history.current;
    if (log && followHistory.current) log.scrollTop = log.scrollHeight;
  }, [chat.id, chat.messages.length, latestReply?.elapsed, docsOpen]);

  function updateDraft(update: (draft: Draft) => Draft) {
    setChats((current) =>
      current.map((entry) =>
        entry.id !== chat.id
          ? entry
          : entry.editDraft
            ? { ...entry, editDraft: update(entry.editDraft) }
            : { ...entry, draft: update(entry.draft) },
      ),
    );
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (archived) return;
    if (
      documents.isPending ||
      updatingDocument ||
      generating ||
      (!draft.text.trim() && !draft.documents.length)
    )
      return;
    const startedAt = performance.now();
    const reply = replyFor(draft.documents, startedAt);
    void saveAttachments(draft.documents);
    followHistory.current = true;
    setChats((current) =>
      current.map((entry) => {
        if (
          entry.id !== chat.id ||
          entry.messages.at(-1)?.reply.state === "generating"
        )
          return entry;
        const pending = entry.editDraft ?? entry.draft;
        const text = pending.text.trim();
        if (!text && !pending.documents.length) return entry;
        return {
          ...entry,
          messages: [
            ...(entry.editDraft ? entry.messages.slice(0, -1) : entry.messages),
            {
              ...pending,
              text,
              reply,
            },
          ],
          draft: entry.editDraft ? entry.draft : { text: "", documents: [] },
          editDraft: null,
        };
      }),
    );
    composer.current?.focus();
  }

  function stopReply() {
    if (archived) return;
    const now = performance.now();
    setChats((current) =>
      current.map((entry) =>
        entry.id === chat.id ? updateReply(entry, now, true) : entry,
      ),
    );
    composer.current?.focus();
  }

  function editLastMessage() {
    if (archived) return;
    setChats((current) =>
      current.map((entry) => {
        const last = entry.messages.at(-1);
        if (
          entry.id !== chat.id ||
          !last ||
          last.reply.state === "generating" ||
          entry.editDraft
        )
          return entry;
        return {
          ...entry,
          editDraft: { text: last.text, documents: last.documents },
        };
      }),
    );
    composer.current?.focus();
  }

  function retryReply() {
    if (archived) return;
    if (documents.isPending || updatingDocument) return;
    const startedAt = performance.now();
    followHistory.current = true;
    setChats((current) =>
      current.map((entry) => {
        const last = entry.messages.at(-1);
        if (
          entry.id !== chat.id ||
          !last ||
          last.reply.state === "generating" ||
          entry.editDraft
        )
          return entry;
        return {
          ...entry,
          messages: [
            ...entry.messages.slice(0, -1),
            { ...last, reply: replyFor(last.documents, startedAt) },
          ],
        };
      }),
    );
    composer.current?.focus();
  }

  return (
    <section className="project-chat" aria-label="Project chat">
      <ChatSidebar
        chats={chats}
        activeChatId={chat.id}
        projectDocsActive={docsOpen}
        onProjectDocsClick={() => showDocs(!docsOpen)}
        onSelectChat={(id) => {
          followHistory.current = true;
          setActiveId(id);
        }}
        onNewChat={
          archived
            ? undefined
            : (name) => {
                const next = createChat(chats.length + 1, name);
                followHistory.current = true;
                setChats((current) => [next, ...current]);
                setActiveId(next.id);
                if (docsOpen) showDocs(false);
                try {
                  localStorage.setItem(chatCountKey, next.id);
                  localStorage.setItem(
                    chatNamesKey,
                    JSON.stringify(
                      [...chats]
                        .reverse()
                        .map((chat) => chat.name)
                        .concat(next.name),
                    ),
                  );
                } catch {
                  // Keep the new chat available while the page is open.
                }
              }
        }
      />
      <div className="project-chat__body">
        <h1>
          {chat.name}
          {docsOpen && " > Project docs"}
        </h1>
        {documentError && (
          <p role="alert" className="project-chat__document-error">
            {documentError}
          </p>
        )}
        {docsOpen ? (
          <>
            <p className="project-chat__docs-intro">
              All documents used in this project are stored here
            </p>
            <div
              className="project-chat__history project-chat__docs"
              aria-label="Project documents"
              tabIndex={0}
            >
              {documents.isError ? (
                <p role="alert">Could not load project documents.</p>
              ) : !documents.isPending && !projectDocuments.length ? (
                <p>No project documents yet.</p>
              ) : null}
              <ul>
                {projectDocuments.map((document) => {
                  const { enabled } = document;
                  return (
                    <li key={document.id}>
                      <span
                        className="chat-sidebar__document-icon"
                        aria-hidden="true"
                      />
                      <div>
                        <strong>{document.name}</strong>
                        <small>{enabled ? "Enabled" : "Disabled"}</small>
                      </div>
                      <button
                        type="button"
                        aria-label={`Use ${document.name} in replies`}
                        aria-pressed={enabled}
                        disabled={archived || updatingDocument}
                        onClick={() =>
                          void toggleDocument(document.id, !enabled)
                        }
                      >
                        {enabled ? (
                          <span
                            className="project-chat__check"
                            aria-hidden="true"
                          />
                        ) : (
                          "×"
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        ) : (
          <>
            <div
              className="project-chat__history"
              ref={history}
              role="log"
              aria-label="Chat messages"
              aria-live={generating ? "off" : "polite"}
              tabIndex={0}
              onScroll={(event) => {
                const log = event.currentTarget;
                followHistory.current =
                  log.scrollHeight - log.clientHeight - log.scrollTop < 24;
              }}
            >
              {chat.messages.length === 0 ? (
                <p className="project-chat__empty">How can I help you?</p>
              ) : (
                <ol>
                  {chat.messages.map(({ text, documents, reply }, index) => {
                    const canRevise =
                      !archived &&
                      index === chat.messages.length - 1 &&
                      reply.state !== "generating" &&
                      !chat.editDraft;
                    return (
                      <li key={index}>
                        <div className="project-chat__user-row">
                          {canRevise && (
                            <button
                              type="button"
                              className="project-chat__message-action"
                              onClick={editLastMessage}
                            >
                              Edit
                            </button>
                          )}
                          <div className="project-chat__user-message">
                            {text && <p>{text}</p>}
                            {documents.length > 0 && (
                              <ul aria-label="Attached documents">
                                {documents.map((file, fileIndex) => (
                                  <li key={fileIndex}>{file.name}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                        <div
                          className="project-chat__reply"
                          aria-label="Assistant response"
                        >
                          <div className="project-chat__reply-meta">
                            {reply.state === "generating" && (
                              <span
                                className="project-chat__dots"
                                role="status"
                                aria-label="Generating response"
                              >
                                <i />
                                <i />
                                <i />
                              </span>
                            )}
                            {reply.state === "stopped" && (
                              <span>Generation stopped</span>
                            )}
                            <span
                              role={
                                reply.state === "generating"
                                  ? "timer"
                                  : undefined
                              }
                            >
                              {(reply.elapsed / 1000).toFixed(1)} s
                            </span>
                          </div>
                          <p>
                            {reply.state === "complete"
                              ? demoReply(reply)
                              : demoReply(reply).slice(
                                  0,
                                  Math.max(
                                    0,
                                    Math.floor(
                                      (reply.elapsed - replyDelay) / 35,
                                    ),
                                  ),
                                )}
                          </p>
                          {canRevise && (
                            <button
                              type="button"
                              className="project-chat__message-action"
                              onClick={retryReply}
                            >
                              Retry
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
            {!archived && (
              <form className="project-chat__composer" onSubmit={send}>
                {draft.documents.length > 0 && (
                  <ul
                    className="project-chat__attachments"
                    aria-label="Pending attachments"
                  >
                    {draft.documents.map((file, index) => (
                      <li key={index}>
                        {file.name}
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          onClick={() =>
                            updateDraft((draft) => ({
                              ...draft,
                              documents: draft.documents.filter(
                                (_, fileIndex) => fileIndex !== index,
                              ),
                            }))
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="project-chat__input-row">
                  <input
                    disabled={archived}
                    ref={picker}
                    type="file"
                    multiple
                    hidden
                    accept=".txt,.pdf,text/plain,application/pdf"
                    aria-label="Chat documents"
                    onChange={(event) => {
                      const files = Array.from(event.currentTarget.files ?? []);
                      event.currentTarget.value = "";
                      if (files.length)
                        updateDraft((draft) => ({
                          ...draft,
                          documents: [...draft.documents, ...files],
                        }));
                    }}
                  />
                  <button
                    type="button"
                    disabled={archived}
                    aria-label="Attach documents"
                    onClick={() => picker.current?.click()}
                  >
                    +
                  </button>
                  <textarea
                    disabled={archived}
                    ref={composer}
                    rows={1}
                    aria-label={chat.editDraft ? "Edit message" : "Message"}
                    placeholder="Type your message..."
                    value={draft.text}
                    onChange={(event) => {
                      const text = event.target.value;
                      updateDraft((draft) => ({ ...draft, text }));
                    }}
                  />
                  {generating ? (
                    <button
                      type="button"
                      key="stop"
                      aria-label="Stop generation"
                      onClick={stopReply}
                    >
                      <span className="project-chat__stop" aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      key="send"
                      type="submit"
                      aria-label="Send message"
                      disabled={
                        archived ||
                        documents.isPending ||
                        updatingDocument ||
                        (!draft.text.trim() && !draft.documents.length)
                      }
                    >
                      <svg
                        className="project-chat__send-icon"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="M12 22V3m-5 5 5-5 5 5" />
                      </svg>
                    </button>
                  )}
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </section>
  );
}
