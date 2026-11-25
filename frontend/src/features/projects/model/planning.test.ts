import { IDBFactory } from "fake-indexeddb";
import {
  listSpecifications,
  readSpecificationFile,
  saveSpecification,
} from "./projectDocuments";
import { expect, it, vi } from "vitest";
import {
  maxSpecificationBytes,
  validateTaskDocument,
} from "./validateTaskDocument";
import {
  createItem,
  emptyBacklog,
  graphProblems,
  readBacklog,
  writeBacklog,
} from "./taskBacklog";

function textFile(text: string, name = "spec.txt") {
  return new File([text], name, { type: "text/plain" });
}

it("validates UTF-8, file type, empty input, size before reads and extracted length", async () => {
  await expect(
    validateTaskDocument(textFile("Requirements\nTask")),
  ).resolves.toEqual({ text: "Requirements\nTask" });
  await expect(
    validateTaskDocument(textFile("text", "spec.docx")),
  ).resolves.toMatchObject({ error: expect.stringContaining("Unsupported") });
  await expect(validateTaskDocument(textFile(""))).resolves.toMatchObject({
    error: expect.stringContaining("empty"),
  });
  await expect(
    validateTaskDocument(new File([new Uint8Array([0xff, 0x00])], "spec.txt")),
  ).resolves.toMatchObject({ error: expect.stringContaining("UTF-8") });
  await expect(
    validateTaskDocument(textFile("x".repeat(200_001))),
  ).resolves.toMatchObject({ error: expect.stringContaining("200,000") });
  const oversized = textFile("x");
  const read = vi.fn();
  Object.defineProperties(oversized, {
    size: { value: maxSpecificationBytes + 1 },
    arrayBuffer: { value: read },
  });
  await expect(validateTaskDocument(oversized)).resolves.toMatchObject({
    error: expect.stringContaining("10 MiB"),
  });
  expect(read).not.toHaveBeenCalled();
});

it("identifies cycles and invalid parents, and preserves a newer revision through a stale write", () => {
  const epic = createItem("epic", null, "Epic");
  const task = createItem("task", epic.id, "Task");
  const child = createItem("subtask", task.id, "Child");
  const graph = graphProblems([
    { ...epic, blockedBy: [task.id] },
    { ...task, blockedBy: [epic.id] },
    { ...child, parentId: epic.id },
  ]);
  expect(graph.cycles).toEqual(new Set([epic.id, task.id]));
  expect(graph.invalid.get(child.id)).toBe("Invalid parent");
  const key = "task-validation-test";
  expect(
    writeBacklog(key, emptyBacklog, { ...emptyBacklog, items: [epic] }),
  ).not.toBeNull();
  expect(
    writeBacklog(key, emptyBacklog, { ...emptyBacklog, items: [task] }),
  ).toBeNull();
  expect(readBacklog(key).items).toEqual([epic]);
  localStorage.removeItem(key);
});

it("accepts optional stories and preserves existing task and subtask types on reload", () => {
  const epic = createItem("epic", null, "Epic");
  const story = createItem("story", epic.id, "Story");
  const directTask = createItem("task", epic.id, "Task under epic");
  const storyTask = createItem("task", story.id, "Task under story");
  const subtask = createItem("subtask", storyTask.id, "Subtask");
  const items = [epic, story, directTask, storyTask, subtask];
  expect(graphProblems(items).invalid.size).toBe(0);

  const invalid = graphProblems([
    epic,
    { ...story, parentId: directTask.id },
    directTask,
    { ...storyTask, parentId: null },
    { ...subtask, parentId: story.id },
  ]).invalid;
  expect([...invalid.keys()]).toEqual([story.id, storyTask.id, subtask.id]);

  const key = "task-story-validation-test";
  try {
    expect(
      writeBacklog(key, emptyBacklog, { ...emptyBacklog, items }),
    ).not.toBeNull();
    expect(readBacklog(key).items).toEqual(items);
  } finally {
    localStorage.removeItem(key);
  }
});

it("stores distinct numbered uploads with author and isolates each project", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  try {
    const first = await saveSpecification(
      "project-a",
      textFile("First draft"),
      "Alex",
    );
    const second = await saveSpecification(
      "project-a",
      textFile("Second draft"),
      "Sam",
    );
    expect(await listSpecifications("project-a")).toEqual([second, first]);
    expect(first).toMatchObject({ version: 1, author: "Alex" });
    expect(second).toMatchObject({ version: 2, author: "Sam" });
    expect(await listSpecifications("project-b")).toEqual([]);
    expect(await readSpecificationFile("project-b", first.id)).toBeNull();
    const saved = await readSpecificationFile("project-a", first.id);
    expect(saved).not.toBeNull();
    if (saved)
      await expect(validateTaskDocument(saved)).resolves.toEqual({
        text: "First draft",
      });
  } finally {
    vi.unstubAllGlobals();
  }
});
