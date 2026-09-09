import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import EditNoteIcon from "@mui/icons-material/EditNote";
import SchoolIcon from "@mui/icons-material/School";
import {
  Avatar,
  Box,
  Card,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client.ts";
import type { SchoolSummary } from "../api/types.ts";

interface Props {
  api: ApiClient;
  onEdit: (schoolId: string) => void;
}

/** 自分が登録した学校の一覧。タップで編集画面へ。 */
export function MySchools({ api, onEdit }: Props) {
  const [schools, setSchools] = useState<SchoolSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listMySchools()
      .then((list) => !cancelled && setSchools(list))
      .catch(() => !cancelled && setSchools([]));
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (schools === null) {
    return (
      <Stack spacing={1.5}>
        <Skeleton variant="rounded" height={72} />
        <Skeleton variant="rounded" height={72} />
      </Stack>
    );
  }

  if (schools.length === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 8 }}>
        <EditNoteIcon sx={{ fontSize: 56, color: "text.disabled" }} />
        <Typography variant="h6" sx={{ mt: 2 }}>
          編集できる学校がありません
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          自分で登録した学校が
          <br />
          ここから編集できます。
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="overline" color="text.secondary">
        自分が登録した学校
      </Typography>
      <Card>
        <List disablePadding>
          {schools.map((s, i) => (
            <ListItemButton key={s.id} divider={i < schools.length - 1} onClick={() => onEdit(s.id)}>
              <ListItemAvatar>
                <Avatar sx={{ bgcolor: "#e8f0fe", color: "#1a73e8", width: 36, height: 36, fontSize: 16 }}>
                  <SchoolIcon fontSize="small" />
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={s.name}
                secondary={`${s.prefecture}${s.city ? ` ${s.city}` : ""}`}
                slotProps={{ primary: { noWrap: true, sx: { fontWeight: 600 } } }}
              />
              <ChevronRightIcon color="action" />
            </ListItemButton>
          ))}
        </List>
      </Card>
    </Box>
  );
}
