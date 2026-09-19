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
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { describeFlowStep } from "@yasumi/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { type FlowRunResult, type School, api } from "../api/client.ts";
import { useToast } from "../components/Toast.tsx";

/** フロー実行結果を「送信 1/1 / フラグ付与「X」」形式に整形。 */
function summarizeRun(r: FlowRunResult): string {
  return r.results
    .map((s) =>
      s.type === "send"
        ? `送信 ${s.sent ?? 0}/${s.total ?? 0}`
        : s.type === "addFlag"
          ? `フラグ付与「${s.flag}」`
          : `フラグ解除「${s.flag}」`,
    )
    .join(" / ");
}

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

  const { data: flagDefs = [] } = useQuery({ queryKey: ["flag-defs"], queryFn: api.getFlagDefs });
  const addFlag = useMutation({
    mutationFn: (name: string) => api.assignFlag([id], name),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ["users"] }); toast.success("フラグを付与しました"); },
    onError,
  });
  const removeFlag = useMutation({
    mutationFn: (name: string) => api.unassignFlag([id], name),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ["users"] }); toast.success("フラグを解除しました"); },
    onError,
  });

  // テンプレート（フロー）をこのユーザーに個別実行。
  const [templateId, setTemplateId] = useState("");
  const { data: flowTemplates = [] } = useQuery({ queryKey: ["flow-templates"], queryFn: api.getFlowTemplates });
  const runTemplate = useMutation({
    mutationFn: (tid: string) => api.runFlowTemplate(tid, { userIds: [id] }),
    onSuccess: (r) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(`実行しました：${summarizeRun(r)}`);
    },
    onError,
  });
  const selectedTemplate = flowTemplates.find((t) => t.id === templateId);
  function runSelectedTemplate() {
    if (!selectedTemplate) return;
    const lines = selectedTemplate.steps.map((s, i) => `${i + 1}. ${describeFlowStep(s)}`);
    if (!window.confirm(`「${selectedTemplate.name}」をこのユーザーに実行します。よろしいですか？\n\n${lines.join("\n")}`)) return;
    runTemplate.mutate(selectedTemplate.id);
  }

  if (!data) return <Typography>読み込み中…</Typography>;

  const availableFlags = flagDefs.map((f) => f.name).filter((n) => !data.flags.includes(n));

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

      {/* フラグ */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>フラグ</Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, mb: 1.5 }}>
            {data.flags.map((f) => (
              <Chip key={f} label={f} onDelete={() => removeFlag.mutate(f)} color="primary" variant="outlined" />
            ))}
            {data.flags.length === 0 && <Typography variant="body2" color="text.secondary">フラグなし</Typography>}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
            <Typography variant="caption" color="text.secondary">付与：</Typography>
            {availableFlags.map((n) => (
              <Chip key={n} label={`＋ ${n}`} size="small" variant="outlined" onClick={() => addFlag.mutate(n)} />
            ))}
            {availableFlags.length === 0 && flagDefs.length > 0 && <Typography variant="caption" color="text.secondary">すべて付与済み</Typography>}
            {flagDefs.length === 0 && <Typography variant="caption" color="text.secondary">フラグ未定義（「フロー」タブで作成）</Typography>}
          </Stack>
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

      {/* テンプレート実行 */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>テンプレートを実行</Typography>
          {flowTemplates.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              フローテンプレートがありません（「フロー」タブで作成してください）。
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                <TextField
                  select
                  size="small"
                  label="フローテンプレート"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  sx={{ flex: 1 }}
                >
                  {flowTemplates.map((t) => (
                    <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                  ))}
                </TextField>
                <Button
                  variant="contained"
                  disabled={!templateId || runTemplate.isPending}
                  onClick={runSelectedTemplate}
                  sx={{ flexShrink: 0 }}
                >
                  このユーザーに実行
                </Button>
              </Stack>
              {selectedTemplate && (
                <Box>
                  <Typography variant="caption" color="text.secondary">実行内容（上から順に）：</Typography>
                  <Stack component="ol" sx={{ pl: 3, m: 0.5 }}>
                    {selectedTemplate.steps.map((s, i) => (
                      <Typography key={i} component="li" variant="body2">{describeFlowStep(s)}</Typography>
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          )}
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
