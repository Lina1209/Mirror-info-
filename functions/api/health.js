
export async function onRequestGet(context) {
    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    };

    const db = context.env?.DB;

    // Проверяем наличие подключения D1
    if (!db) {
        return new Response(
            JSON.stringify({
                ok: false,
                service: "mirror-info",
                database: "not_configured",
                schema: "unknown",
                error: "D1 binding DB is not configured"
            }),
            {
                status: 503,
                headers
            }
        );
    }

    try {
        // Проверяем наличие обязательных таблиц
        const result = await db.prepare(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name IN ('orders', 'order_rate_limits')
        `).all();

        const tables = (result.results || [])
            .map(row => row.name);

        const hasOrders = tables.includes("orders");
        const hasRateLimits = tables.includes("order_rate_limits");

        const schemaReady = hasOrders && hasRateLimits;

        return new Response(
            JSON.stringify({
                ok: schemaReady,
                service: "mirror-info",
                database: "connected",
                schema: schemaReady ? "ready" : "incomplete",
                tables: {
                    orders: hasOrders,
                    order_rate_limits: hasRateLimits
                },
                checked_at: new Date().toISOString()
            }),
            {
                status: schemaReady ? 200 : 503,
                headers
            }
        );

    } catch (error) {
        return new Response(
            JSON.stringify({
                ok: false,
                service: "mirror-info",
                database: "connected",
                schema: "error",
                error: "Database check failed"
            }),
            {
                status: 500,
                headers
            }
        );
    }
}
