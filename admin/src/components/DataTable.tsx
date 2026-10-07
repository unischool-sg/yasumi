import SearchIcon from "@mui/icons-material/Search";
import {
  Box,
  InputAdornment,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from "@mui/material";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";

interface Props<T> {
  // biome-ignore lint: 汎用のためカラム値型は any
  columns: ColumnDef<T, any>[];
  data: T[];
  empty?: string;
  searchable?: boolean;
  pageSize?: number;
  /** 行クリック時のコールバック（指定時は行をポインタ表示にする）。 */
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({ columns, data, empty, searchable = true, pageSize = 25, onRowClick }: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize });

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const total = table.getFilteredRowModel().rows.length;

  return (
    <Box>
      {searchable && (
        <TextField
          size="small"
          placeholder="絞り込み検索…"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          sx={{ mb: 1.5, width: 320, maxWidth: "100%" }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            },
          }}
        />
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small" stickyHeader>
          <TableHead>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => {
                  const canSort = h.column.getCanSort();
                  return (
                    <TableCell key={h.id} sx={{ fontWeight: 700, bgcolor: "#f8f9fa", whiteSpace: "nowrap" }}>
                      {h.isPlaceholder ? null : canSort ? (
                        <TableSortLabel active={!!h.column.getIsSorted()} direction={h.column.getIsSorted() || "asc"} onClick={h.column.getToggleSortingHandler()}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                        </TableSortLabel>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableHead>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                hover
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                sx={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                ))}
              </TableRow>
            ))}
            {total === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
                    {empty ?? "データがありません"}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={total}
          page={pagination.pageIndex}
          onPageChange={(_, p) => setPagination((s) => ({ ...s, pageIndex: p }))}
          rowsPerPage={pagination.pageSize}
          onRowsPerPageChange={(e) => setPagination({ pageIndex: 0, pageSize: Number(e.target.value) })}
          rowsPerPageOptions={[25, 50, 100, 200]}
          labelRowsPerPage="表示件数"
        />
      </TableContainer>
    </Box>
  );
}
