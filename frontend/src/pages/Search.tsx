import { useState } from "react";
import type { ApiClient } from "../api/client.ts";
import type { SchoolSummary } from "../api/types.ts";

interface Props {
  api: ApiClient;
  subscribedIds: Set<string>;
  onSubscribed: () => void;
}

/** 学校検索 → 購読（PRD §11, §12）。 */
export function Search({ api, subscribedIds, onSubscribed }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SchoolSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function search() {
    if (!q.trim()) return;
    setLoading(true);
    try {
      setResults(await api.searchSchools(q.trim()));
    } finally {
      setLoading(false);
    }
  }

  async function subscribe(schoolId: string) {
    setBusyId(schoolId);
    try {
      await api.subscribe(schoolId);
      onSubscribed();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2"
          placeholder="学校名で検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button
          className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
          onClick={search}
          disabled={loading}
        >
          検索
        </button>
      </div>

      {results?.length === 0 && (
        <p className="text-sm text-slate-500">学校が見つかりません。</p>
      )}

      <ul className="flex flex-col gap-2">
        {results?.map((s) => {
          const subscribed = subscribedIds.has(s.id);
          return (
            <li key={s.id} className="flex items-center justify-between rounded-xl bg-white p-4 shadow">
              <div>
                <p className="font-semibold">{s.name}</p>
                <p className="text-sm text-slate-500">
                  {s.prefecture}
                  {s.city ? ` ${s.city}` : ""}
                </p>
              </div>
              <button
                className="rounded-lg border border-emerald-600 px-3 py-1 text-sm font-semibold text-emerald-700 disabled:opacity-50"
                onClick={() => subscribe(s.id)}
                disabled={subscribed || busyId === s.id}
              >
                {subscribed ? "登録済み" : "この学校を登録"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
