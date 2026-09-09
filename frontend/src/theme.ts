import { createTheme } from "@mui/material/styles";

// Material Design（Material 3 / You 寄り）テーマ。
// Google ブルーを primary に、Roboto、丸め角、フィルド入力、標準エレベーション。
export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1a73e8" },
    secondary: { main: "#5f6368" },
    background: { default: "#f8f9fa", paper: "#ffffff" },
    text: { primary: "#1f1f1f", secondary: "#444746" },
    success: { main: "#1e8e3e" },
    warning: { main: "#f9ab00" },
    error: { main: "#d93025" },
  },
  shape: { borderRadius: 16 },
  typography: {
    fontFamily: ["Roboto", '"Noto Sans JP"', "-apple-system", "BlinkMacSystemFont", "sans-serif"].join(","),
    h6: { fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    // Material のボタンはピル型（M3）。エレベーションは付けない。
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 20 } },
    },
    MuiAppBar: {
      defaultProps: { color: "default" },
      styleOverrides: { root: { backgroundColor: "#ffffff", color: "#1f1f1f" } },
    },
    // エレベーテッド・カード（Material の標準影を使用）。
    MuiCard: {
      defaultProps: { elevation: 1 },
      styleOverrides: { root: { borderRadius: 16 } },
    },
    // Material の入力はフィルド（M3 既定）。
    MuiTextField: { defaultProps: { variant: "filled" } },
    MuiFormControl: { defaultProps: { variant: "filled" } },
    MuiFilledInput: {
      styleOverrides: { root: { borderRadius: 8, "&::before, &::after": { display: "none" } } },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
  },
});
