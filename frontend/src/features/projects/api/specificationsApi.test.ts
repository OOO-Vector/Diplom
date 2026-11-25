import { afterEach, describe, expect, it, vi } from "vitest";
import { authSession } from "../../account/authSession";
import { specificationsApi } from "./specificationsApi";

const projectId = "38ea3155-4081-467e-9e86-98774f11cff3";
const id = "ad1bebe9-9489-4755-acb5-9248d5e77cc9";
const collection = `/projects/${projectId}/specifications`;
const document = { id, originalFilename: "requirements.txt" };
const signal = new AbortController().signal;

afterEach(() => vi.restoreAllMocks());

describe("specificationsApi", () => {
  it("uploads exactly one named file and one title", async () => {
    const request = vi
      .spyOn(authSession, "request")
      .mockResolvedValue(document);
    const file = new File(["A requirement"], "requirements.txt");

    await expect(
      specificationsApi.upload(projectId, file, signal),
    ).resolves.toEqual({
      id,
      name: document.originalFilename,
    });

    const config = request.mock.calls[0]![1];
    expect(config).toMatchObject({ url: collection, method: "POST", signal });
    expect(config.headers).toBeUndefined();
    const data = config.data as FormData;
    expect(Array.from(data.keys())).toEqual(["file", "title"]);
    expect(data.get("file")).toMatchObject({
      name: file.name,
      size: file.size,
      type: "text/plain",
    });
    expect(data.get("title")).toBe(file.name);
  });

  it("reads the latest version from the project collection", async () => {
    const request = vi.spyOn(authSession, "request").mockResolvedValue({
      items: [document],
    });

    await expect(specificationsApi.latest(projectId, signal)).resolves.toEqual([
      { id, name: document.originalFilename },
    ]);
    expect(request).toHaveBeenCalledWith(expect.anything(), {
      url: collection,
      params: { page: 0, size: 1 },
      signal,
    });
  });

  it("reads server-extracted text for the selected version as plain text", async () => {
    const request = vi
      .spyOn(authSession, "request")
      .mockResolvedValueOnce(document)
      .mockResolvedValueOnce('{"this is still text": true}');

    await expect(
      specificationsApi.source(projectId, id, signal),
    ).resolves.toEqual({
      text: '{"this is still text": true}',
      name: document.originalFilename,
    });
    expect(request).toHaveBeenNthCalledWith(2, expect.anything(), {
      url: `${collection}/${id}/text`,
      responseType: "text",
      headers: { Accept: "text/plain" },
      signal,
    });
  });
});
