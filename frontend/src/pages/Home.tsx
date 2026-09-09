import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client.ts";
import type { SchoolSummary, Subscription } from "../api/types.ts";

interface Props {
  api: ApiClient;
  subscriptions: Subscription[];
  onChanged: () => void;
}

/**
 * ホーム: 購読中の学校一覧。今日の状態表示（GET /schools/:id/status）は M7 で追加する。
 */
export function Home({ api, subscriptions, onChanged }: Props) {
  const [schools, setSchools] = useState<Record<string, SchoolSummary>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(subscriptions.map((s) => api.getSchool(s.schoolId))).then((list) => {
      if (cancelled) return;
      const map: Record<string, SchoolSummary> = {};
      for (const s of list) map[s.id] = s;
      setSchools(map);
    });
    return () => {
      cancelled = true;
    };
  }, [api, subscriptions]);

  async function unsubscribe(schoolId: string) {
    setBusyId(schoolId);
    try {
      await api.unsubscribe(schoolId);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  if (subscriptions.length === 0) {
    return <p className="text-sm text-slate-500">まだ学校を登録していません。「検索」から登録してください。</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {subscriptions.map((sub) => {
        const school = schools[sub.schoolId];
        return (
          <li key={sub.schoolId} className="rounded-2xl bg-white p-4 shadow">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{school?.name ?? "…"}</p>
              <button
                className="text-sm text-slate-400 disabled:opacity-50"
                onClick={() => unsubscribe(sub.schoolId)}
                disabled={busyId === sub.schoolId}
              >
                解除
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              🟢 判定は次回の判定時刻から通知されます
            </p>
          </li>
        );
      })}
    </ul>
  );
}
