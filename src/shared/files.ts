export function downloadBytes(name: string, bytes: Uint8Array | string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(name: string, text: string, type = "text/plain") {
  downloadBytes(name, text, `${type};charset=utf-8`);
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Fetch a file published with the site (relative to the page, so it works under /<repo>/). */
export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(new URL(path, document.baseURI), { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}
