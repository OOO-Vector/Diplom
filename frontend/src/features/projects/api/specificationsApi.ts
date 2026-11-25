import { z } from "zod";
import { authSession } from "../../account/authSession";

const metadata = z.object({
  id: z.string().uuid(),
  originalFilename: z.string(),
});
const list = z.object({ items: z.array(metadata) });

const path = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}/specifications`;

export const specificationsApi = {
  async latest(projectId: string, signal: AbortSignal) {
    const { items } = await authSession.request(list, {
      url: path(projectId),
      params: { page: 0, size: 1 },
      signal,
    });
    return items.map(({ id, originalFilename }) => ({
      id,
      name: originalFilename,
    }));
  },
  async upload(projectId: string, file: File, signal: AbortSignal) {
    const type = /\.pdf$/i.test(file.name) ? "application/pdf" : "text/plain";
    const title = Array.from(file.name.replace(/\p{Cc}/gu, "_").trim())
      .slice(0, 200)
      .join("");
    const data = new FormData();
    data.append("file", file.slice(0, file.size, type), file.name);
    data.append("title", title);
    const { id, originalFilename } = await authSession.request(metadata, {
      url: path(projectId),
      method: "POST",
      data,
      signal,
    });
    return { id, name: originalFilename };
  },
  async source(projectId: string, id: string, signal: AbortSignal) {
    const url = `${path(projectId)}/${encodeURIComponent(id)}`;
    const { originalFilename } = await authSession.request(metadata, {
      url,
      signal,
    });
    const text = await authSession.request(z.string(), {
      url: `${url}/text`,
      responseType: "text",
      headers: { Accept: "text/plain" },
      signal,
    });
    return { text, name: originalFilename };
  },
};
