import { createTheme } from "@mui/material/styles";

// 先生ダッシュボードは「公式・信頼」の緑をアクセントに（社内adminの青と差別化）。
export const theme = createTheme({
  palette: {
    primary: { main: "#1e8e3e" },
    background: { default: "#f5f6f8", paper: "#ffffff" },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: ["Roboto", '"Noto Sans JP"', "sans-serif"].join(","),
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiAppBar: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundColor: "#1e8e3e" } } },
  },
});
