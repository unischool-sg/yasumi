import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { type School, api } from "../api/client.ts";
import { useToast } from "../components/Toast.tsx";

export function UserDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ["user", id], queryFn: () => api.getUser(id) });

  const [message, setMessage] = useState("");
  const [schoolQuery, setSchoolQuery] = useState("");
  const [picked, setPicked] = useState<School | null>(null);
  const { data: schoolOptions = [] } = useQuery({
    queryKey: ["admin-school-search", schoolQuery],
    queryFn: () => api.listSchools(schoolQuery),
    enabled: schoolQuery.length > 0,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["user", id] });
  const onError = (e: unknown) => toast.error(`失敗しました: ${(e as Error).message}`);

  const sendMsg = useMutation({
    mutationFn: () => api.sendUserMessage(id, message),
    onSuccess: () => { setMessage(""); toast.success("メッセージを送信しました"); },
    onError,
  });
  const addSub = useMutation({
    mutationFn: (schoolId: string) => api.addUserSubscription(id, schoolId),
    onSuccess: () => { setPicked(null); setSchoolQuery(""); invalidate(); toast.success("購読を追加しました"); },
    onError,
  });
  const toggleSub = useMutation({
    mutationFn: (v: { schoolId: string; enabled: boolean }) => api.setUserSubscription(id, v.schoolId, v.enabled),
    onSuccess: () => { invalidate(); toast.success("更新しました"); },
    onError,
  });
  const removeSub = useMutation({
    mutationFn: (schoolId: string) => api.removeUserSubscription(id, schoolId),
    onSuccess: () => { invalidate(); toast.success("購読を削除しました"); },
    onError,
  });

  if (!data) return <Typography>読み込み中…</Typography>;

  return (
    <Box>
      <Button onClick={() => navigate({ to: "/users" })} size="small" sx={{ mb: 1 }}>
        ← ユーザー一覧
      </Button>

      {/* プロフィール */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <Avatar src={data.profile?.pictureUrl} sx={{ width: 56, height: 56 }}>
              {data.profile?.displayName?.[0] ?? "?"}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {data.profile?.displayName ?? "（名前未取得）"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <code style={{ fontSize: 12 }}>{data.lineUserId ?? "LINE未連携"}</code>
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                <Chip size="small" label={`購読 ${data.subscriptions.length}`} />
                <Chip size="small" label={`デバイス ${data.deviceTokenCount}`} color={data.deviceTokenCount > 0 ? "success" : "default"} />
              </Stack>
            </Box>
          </Stack>
          {!data.profile && data.lineUserId && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
              ※プロフィールは公式アカウントを友だち追加済みのユーザーのみ表示されます。
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* メッセージ送信 */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>メッセージ送信</Typography>
          <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              placeholder="このユーザーに送るメッセージ（デバイス登録があればアプリ通知、無ければLINE）"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <Button variant="contained" disabled={!message.trim() || sendMsg.isPending} onClick={() => sendMsg.mutate()} sx={{ flexShrink: 0, mt: 0.5 }}>
              送信
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* 購読 */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>購読中の学校</Typography>
          <Stack spacing={1} sx={{ mb: 2 }}>
            {data.subscriptions.map((s) => (
              <Stack key={s.schoolId} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography sx={{ flex: 1, minWidth: 0 }} noWrap>{s.schoolName}</Typography>
                <Switch
                  size="small"
                  checked={s.notificationEnabled}
                  onChange={(e) => toggleSub.mutate({ schoolId: s.schoolId, enabled: e.target.checked })}
                />
                <Typography variant="caption" color="text.secondary" sx={{ width: 56 }}>
                  {s.notificationEnabled ? "通知ON" : "通知OFF"}
                </Typography>
                <Button size="small" color="error" onClick={() => removeSub.mutate(s.schoolId)}>削除</Button>
              </Stack>
            ))}
            {data.subscriptions.length === 0 && <Typography variant="body2" color="text.secondary">購読がありません</Typography>}
          </Stack>

          <Divider sx={{ my: 2 }} />

          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <Autocomplete
              size="small"
              sx={{ flex: 1 }}
              options={schoolOptions}
              getOptionLabel={(o) => `${o.name}（${o.prefecture}）`}
              filterOptions={(x) => x}
              value={picked}
              onChange={(_, v) => setPicked(v)}
              onInputChange={(_, v) => setSchoolQuery(v)}
              noOptionsText="学校名で検索"
              renderInput={(params) => <TextField {...params} label="購読する学校を追加" />}
            />
            <Button variant="outlined" disabled={!picked || addSub.isPending} onClick={() => picked && addSub.mutate(picked.id)} sx={{ flexShrink: 0 }}>
              追加
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
