import CheckIcon from "@mui/icons-material/Check";
import SearchIcon from "@mui/icons-material/Search";
import {
  Avatar,
  Box,
  Button,
  Card,
  InputAdornment,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import type { ApiClient } from "../api/client.ts";
import type { SchoolSummary } from "../api/types.ts";

interface Props {
  api: ApiClient;
  subscribedIds: Set<string>;
  onSubscribed: () => void;
  onRegister: (name: string) => void;
  onNotify: (message: string) => void;
}

export function Search({ api, subscribedIds, onSubscribed, onRegister, onNotify }: Props) {
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
      onNotify("通知をONにしました");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Box>
      <Paper
        elevation={2}
        sx={{ display: "flex", alignItems: "center", gap: 1, p: 0.75, pl: 1.5, borderRadius: 999 }}
      >
        <TextField
          fullWidth
          size="small"
          variant="standard"
          placeholder="学校名で検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          slotProps={{
            input: {
              disableUnderline: true,
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Button variant="contained" onClick={search} disabled={loading || !q.trim()}>
          検索
        </Button>
      </Paper>

      {results?.length === 0 && (
        <Card sx={{ mt: 2, p: 3, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            「{q}」は見つかりませんでした。
          </Typography>
          <Button variant="contained" onClick={() => onRegister(q.trim())} sx={{ mt: 2 }}>
            この学校を新規登録
          </Button>
        </Card>
      )}

      {results && results.length > 0 && (
        <Card sx={{ mt: 2 }}>
          <List disablePadding>
            {results.map((s, i) => {
              const subscribed = subscribedIds.has(s.id);
              return (
                <ListItem
                  key={s.id}
                  divider={i < results.length - 1}
                  secondaryAction={
                    subscribed ? (
                      <Button size="small" color="success" startIcon={<CheckIcon />} disabled>
                        登録済み
                      </Button>
                    ) : (
                      <Button size="small" variant="contained" disabled={busyId === s.id} onClick={() => subscribe(s.id)}>
                        登録
                      </Button>
                    )
                  }
                >
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: "#e8f0fe", color: "#1a73e8", width: 36, height: 36, fontSize: 16 }}>
                      {s.name.charAt(0)}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={s.name}
                    secondary={`${s.prefecture}${s.city ? ` ${s.city}` : ""}`}
                    slotProps={{ primary: { noWrap: true, sx: { fontWeight: 600 } } }}
                  />
                </ListItem>
              );
            })}
          </List>
        </Card>
      )}
    </Box>
  );
}
