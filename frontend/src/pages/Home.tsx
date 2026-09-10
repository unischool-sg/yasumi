import SchoolIcon from "@mui/icons-material/School";
import {
  Box,
  Button,
  Card,
  List,
  ListItem,
  ListItemText,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client.ts";
import type { SchoolStatus, Subscription } from "../api/types.ts";
import { StatusHero } from "../components/StatusHero.tsx";
import { STATUS_STYLE } from "../lib/status.ts";

interface Props {
  api: ApiClient;
  subscriptions: Subscription[];
  onChanged: () => void;
  onGoSearch: () => void;
  onNotify: (message: string) => void;
  /** 欠席受付対応校がある場合の導線（premium 校）。 */
  showAbsence?: boolean;
  onAbsence?: () => void;
}

export function Home({ api, subscriptions, onChanged, onGoSearch, onNotify, showAbsence, onAbsence }: Props) {
  const [statuses, setStatuses] = useState<SchoolStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(subscriptions.map((s) => api.getStatus(s.schoolId)))
      .then((list) => !cancelled && setStatuses(list))
      .catch(() => !cancelled && setStatuses([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [api, subscriptions]);

  async function unsubscribe(schoolId: string) {
    setBusyId(schoolId);
    try {
      await api.unsubscribe(schoolId);
      onChanged();
      onNotify("通知を解除しました");
    } finally {
      setBusyId(null);
    }
  }

  if (subscriptions.length === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 8 }}>
        <SchoolIcon sx={{ fontSize: 56, color: "text.disabled" }} />
        <Typography variant="h6" sx={{ mt: 2 }}>
          学校を登録しましょう
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          登録すると、警報ルールに応じて
          <br />
          今日の登校可否を自動で通知します。
        </Typography>
        <Button variant="contained" onClick={onGoSearch} startIcon={<SchoolIcon />} sx={{ mt: 3 }}>
          学校を探す
        </Button>
      </Box>
    );
  }

  const [hero, ...rest] = statuses;

  return (
    <Stack spacing={2}>
      {loading && statuses.length === 0 ? (
        <Skeleton variant="rounded" height={168} />
      ) : (
        hero && <StatusHero status={hero} />
      )}

      {showAbsence && onAbsence && (
        <Button variant="outlined" color="success" onClick={onAbsence} fullWidth sx={{ py: 1.2 }}>
          欠席・遅刻を学校へ連絡する
        </Button>
      )}

      {rest.length > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            ほかの学校
          </Typography>
          <Card>
            <List disablePadding>
              {rest.map((st) => {
                const style = st.latest ? STATUS_STYLE[st.latest.result] : null;
                return (
                  <ListItem
                    key={st.schoolId}
                    divider
                    secondaryAction={
                      <Button size="small" color="inherit" disabled={busyId === st.schoolId} onClick={() => unsubscribe(st.schoolId)}>
                        解除
                      </Button>
                    }
                  >
                    <Box
                      sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: style?.color ?? "#dadce0", mr: 1.5, flexShrink: 0 }}
                    />
                    <ListItemText primary={st.schoolName} secondary={style ? style.label : "判定待ち"} />
                  </ListItem>
                );
              })}
            </List>
          </Card>
        </Box>
      )}

      {hero && (
        <Button color="inherit" size="small" disabled={busyId === hero.schoolId} onClick={() => unsubscribe(hero.schoolId)} sx={{ color: "text.secondary" }}>
          この学校の通知を解除
        </Button>
      )}
    </Stack>
  );
}
