export async function ollamaIsAvailable(ollamaUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${ollamaUrl}/api/tags`, {
      signal: controller.signal,
    });

    clearTimeout(timer);
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function ollamaListModels(ollamaUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`);
    if (!res.ok) return [];

    const data = (await res.json()) as {
      models?: Array<{ name: string }>;
    };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}
