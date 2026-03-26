"""
Compatibility layer for SQLite vs PostgreSQL query syntax.
"""
from app.config import DB_TYPE


def ph(index: int = 0) -> str:
    """Parameter placeholder: %s for PostgreSQL, ? for SQLite."""
    return "%s" if DB_TYPE == "postgresql" else "?"


def returning_id(cur, table: str) -> int:
    """Get last inserted ID (RETURNING for PG, lastrowid for SQLite)."""
    if DB_TYPE == "postgresql":
        return cur.fetchone()["id"]
    return cur.lastrowid


def execute_returning(cur, sql: str, params: tuple, conn=None):
    """
    Execute INSERT/UPDATE and return the affected row.
    For PostgreSQL: uses RETURNING *
    For SQLite: executes the statement then SELECTs the row by ID.
    """
    if DB_TYPE == "postgresql":
        if "RETURNING" not in sql:
            sql += " RETURNING *"
        cur.execute(sql, params)
        return cur.fetchone()
    else:
        # Strip RETURNING clause for SQLite
        clean_sql = sql
        if "RETURNING" in clean_sql:
            clean_sql = clean_sql[:clean_sql.index("RETURNING")].strip()
        cur.execute(clean_sql, params)

        # Figure out the table name and get the row
        table = _extract_table(sql)
        if "INSERT" in sql.upper():
            row_id = cur.lastrowid
        elif "UPDATE" in sql.upper() or "DELETE" in sql.upper():
            # For updates/deletes, we need the ID from params or WHERE clause
            # Caller should handle this
            return None
        else:
            return None

        cur.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,))
        return cur.fetchone()


def _extract_table(sql: str) -> str:
    """Extract table name from SQL statement."""
    sql_upper = sql.upper().strip()
    if sql_upper.startswith("INSERT INTO"):
        parts = sql.strip().split()
        return parts[2]
    elif sql_upper.startswith("UPDATE"):
        parts = sql.strip().split()
        return parts[1]
    elif sql_upper.startswith("DELETE FROM"):
        parts = sql.strip().split()
        return parts[2]
    return ""


def adapt_sql(sql: str) -> str:
    """Convert PostgreSQL-flavored SQL to work with current DB_TYPE."""
    if DB_TYPE == "sqlite":
        # Replace %s with ?
        sql = sql.replace("%s", "?")
        # Replace NOW() with datetime('now')
        sql = sql.replace("NOW()", "datetime('now')")
        # Replace ILIKE with LIKE (SQLite is case-insensitive by default for ASCII)
        sql = sql.replace("ILIKE", "LIKE")
        # Replace ANY(%s) with a different approach — caller handles this
        # Replace FILTER (WHERE ...) — SQLite doesn't support this
        # Replace boolean TRUE/FALSE
    return sql


def any_array_sql(column: str, param_name: str = "?") -> str:
    """
    Generate SQL for 'column IN (list)' that works for both DBs.
    For PostgreSQL: column = ANY(%s) with list param
    For SQLite: caller must expand to column IN (?, ?, ...)
    """
    if DB_TYPE == "postgresql":
        return f"{column} = ANY(%s)"
    else:
        return f"{column} IN ({param_name})"
