import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from "@mui/material";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api/client.ts";
import { setAuth } from "../lib/auth.ts";

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const auth = await api.login(email, password);
      setAuth(auth);
      navigate({ to: "/" });
    } catch {
      setError("メールアドレスまたはパスワードが違います");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", bgcolor: "background.default", p: 2 }}>
      <Card variant="outlined" sx={{ width: 400, maxWidth: "100%" }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            やすみ？ 先生ダッシュボード
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            学校から発行された教員アカウントでログイン
          </Typography>
          <Stack spacing={2} component="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <TextField label="メールアドレス" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus fullWidth />
            <TextField label="パスワード" type="password" value={password} onChange={(e) => setPassword(e.target.value)} fullWidth />
            {error && <Alert severity="error">{error}</Alert>}
            <Button type="submit" variant="contained" size="large" disabled={loading || !email || !password}>
              {loading ? "ログイン中…" : "ログイン"}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
