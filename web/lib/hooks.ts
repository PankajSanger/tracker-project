"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { DEFAULT_SETTINGS } from "./types";
import type { PostRow, Settings } from "./types";

/** Posts + settings, with a reload function. `posts` is null until the first load finishes. */
export function usePosts() {
  const [posts, setPosts] = useState<PostRow[] | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api.posts(), api.settings().catch(() => DEFAULT_SETTINGS)]);
      setPosts(p);
      setSettings(s);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load data");
      setPosts((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { posts, settings, error, reload };
}
