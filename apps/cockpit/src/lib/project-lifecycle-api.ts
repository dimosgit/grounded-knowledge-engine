export async function moveProjectLifecycle(path: string, lifecycle: string): Promise<void> {
  const response = await fetch("/__board/lifecycle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, lifecycle }),
  });
  if (!response.ok) throw new Error(await response.text());
}
