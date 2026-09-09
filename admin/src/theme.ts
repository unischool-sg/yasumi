import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    primary: { main: "#1a73e8" },
    background: { default: "#f5f6f8", paper: "#ffffff" },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: ["Roboto", '"Noto Sans JP"', "sans-serif"].join(","),
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiAppBar: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundColor: "#1a73e8" } } },
  },
});
