 import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "";

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value) || 0);
}

function mapOrder(order) {
  return {
    id: order.order_id,
    amount: order.amount,
    status: order.status,
    createdAt: new Date(order.created_at).toLocaleString(),
    approvalUrl: order.approval_url,
  };
}

function App() {
  const [health, setHealth] = useState("checking");
  const [amount, setAmount] = useState("10.00");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [transactions, setTransactions] = useState([]);
const [verificationStatus, setVerificationStatus] = useState({});

const syncingRef = useRef(false);

  // Load the latest saved order history from the backend.
  const loadTransactions = useCallback(async () => {
    const response = await fetch(`${API_URL}/api/payments/orders`);

    if (!response.ok) {
      throw new Error("Could not load saved orders.");
    }

    const data = await response.json();

    if (!Array.isArray(data.orders)) {
      throw new Error("The backend returned an unexpected order history.");
    }

    setTransactions(data.orders.map(mapOrder));
  }, []);

  // Check unfinished order statuses without capturing any payments.

const syncOrderStatuses = useCallback(async () => {  if (syncingRef.current) {
    return null;
  }

  syncingRef.current = true;

  try {
    const response = await fetch(`${API_URL}/api/payments/orders`);

    if (!response.ok) {
      throw new Error("Could not retrieve saved orders.");
    }

    const data = await response.json();

    if (!Array.isArray(data.orders)) {
      throw new Error("Unexpected order history from backend.");
    }

    const results = await Promise.all(
      data.orders.map(async (order) => {
        try {
          const statusResponse = await fetch(
            `${API_URL}/api/payments/orders/${encodeURIComponent(order.order_id)}`
          );

          if (!statusResponse.ok) {
            return {
              id: order.order_id,
              verification: "error",
              orderStatus: null,
              captureStatus: null,
              captureReason: null,
              captureId: null,
              success: false,
            };
          }

          const statusData = await statusResponse.json();

          if (typeof statusData.status !== "string" || !statusData.status) {
            return {
              id: order.order_id,
              verification: "error",
              orderStatus: null,
              captureStatus: null,
              captureReason: null,
              captureId: null,
              success: false,
            };
          }

          return {
            id: order.order_id,
            verification: "verified",
            orderStatus: statusData.status,
            captureStatus: statusData.capture_status || "UNKNOWN",
            captureReason: statusData.capture_reason || null,
            captureId: statusData.capture_id || null,
            success: true,
          };
        } catch {
          return {
            id: order.order_id,
            verification: "error",
            orderStatus: null,
            captureStatus: null,
            captureReason: null,
            captureId: null,
            success: false,
          };
        }
      })
    );
    setVerificationStatus((previous) => {
      const updated = { ...previous };

      for (const result of results) {
        updated[result.id] = result;
      }

      return updated;
    });

    await loadTransactions();

    return results.some((result) => !result.success);
  } finally {
    syncingRef.current = false;
  }
}, [loadTransactions]);


  // Initialize the dashboard and load saved order history.
  useEffect(() => {
    let active = true;

    async function initializeDashboard() {
      try {
        const response = await fetch(`${API_URL}/api/health`);

        if (!response.ok) {
          throw new Error("Backend unavailable.");
        }

        const data = await response.json();

        if (!active) return;

        if (data.status !== "ok") {
          throw new Error("Backend health check failed.");
        }

        setHealth("connected");

        const historyResponse = await fetch(
          `${API_URL}/api/payments/orders`
        );

        if (!historyResponse.ok) {
          throw new Error("Could not load saved orders.");
        }

        const history = await historyResponse.json();

        if (!Array.isArray(history.orders)) {
          throw new Error("The backend returned an unexpected order history.");
        }

        if (active) {
          setTransactions(history.orders.map(mapOrder));
        }
      } catch (err) {
        if (active) {
          setHealth("offline");
          setError(
            `${err.message} Check that FastAPI is running on port 8000.`
          );
          console.error("Dashboard initialization failed:", err);
        }
      }
    }

    initializeDashboard();

    return () => {
      active = false;
    };
  }, []);

  // Automatically refresh unfinished order statuses every 30 seconds.
  useEffect(() => {
    if (health !== "connected") {
      return;
    }

    let active = true;

    async function runStatusSync() {
      try {
        await syncOrderStatuses();
      } catch (err) {
        if (active) {
          console.warn(
            "Automatic status refresh failed:",
            err.message
          );
        }
      }
    }

    runStatusSync();

    const intervalId = window.setInterval(runStatusSync, 30000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [health, syncOrderStatuses]);

  // Manually refresh saved orders and their current statuses.
  async function refreshOrders() {
    setRefreshing(true);
    setError("");
    setNotice("");

    try {
      const hadFailures = await syncOrderStatuses({ force: true });

      if (hadFailures === null) {
        setNotice("A status refresh is already in progress.");
      } else if (hadFailures) {
        setNotice(
          "Saved orders refreshed. Some PayPal statuses could not be checked; try again shortly."
        );
      } else {
        setNotice("Saved order history and statuses refreshed.");
      }
    } catch (err) {
      setError(
        `${err.message} Check that your backend is running on port 8000.`
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function createPayment() {
    setError("");
    setNotice("");

    const numericAmount = Number(amount);

    if (
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0 ||
      numericAmount > 10000 ||
      !/^\d+(\.\d{1,2})?$/.test(amount)
    ) {
      setError(
        "Enter an amount from $0.01 to $10,000.00 with up to 2 decimal places."
      );
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/payments/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: numericAmount.toFixed(2),
          currency: "USD",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Could not create the payment order."
        );
      }

      await loadTransactions();

      if (data.approval_url) {
        setNotice(`Sandbox order ${data.order_id} created successfully.`);
        window.open(data.approval_url, "_blank", "noopener,noreferrer");
      } else {
        setNotice(
          "Order created, but PayPal did not return an approval link."
        );
      }
    } catch (err) {
      setError(
        `${err.message} Check that your FastAPI backend is running on port 8000.`
      );
    } finally {
      setLoading(false);
    }
  }

  const completed = transactions.filter(
    (transaction) => transaction.status === "COMPLETED"
  );

  const totalCreated = transactions.reduce(
    (sum, transaction) => sum + Number(transaction.amount || 0),
    0
  );

  const pending = transactions.filter(
    (transaction) => transaction.status !== "COMPLETED"
  ).length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div>
            <div className="brand-name">PayPilot</div>
            <div className="brand-subtitle">AI PAYMENTS</div>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>
        <div className="nav-item active"><span># </span> Overview</div>
        <div className="nav-item"><span>&lt;&gt;</span> Transactions</div>
        <div className="nav-item"><span>+ </span> Payment links</div>
        <div className="nav-item"><span>* </span> AI insights</div>

        <div className="sidebar-bottom">
          <div className="sandbox-card">
            <span className="status-dot" />
            <div>
              <strong>Sandbox mode</strong>
              <p>Test environment only</p>
            </div>
          </div>
          <div className="profile">
            <div className="avatar">PP</div>
            <div>
              <strong>PayPilot workspace</strong>
              <p>Merchant dashboard</p>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="breadcrumb">Workspace <span>/</span> Overview</div>
            <h1>Payment overview</h1>
            <p className="page-subtitle">
              Monitor your sandbox payments and explore your payment workflow.
            </p>
          </div>

          <div className={`connection-pill ${health}`}>
            <span className="status-dot" />
            {health === "checking"
              ? "Checking API"
              : health === "connected"
                ? "API connected"
                : "API offline"}
          </div>
        </header>

        <section className="welcome-banner">
          <div className="welcome-copy">
            <div className="eyebrow">PAYPILOT AI - MERCHANT TOOLS</div>
            <h2>Payments, made clearer.</h2>
            <p>
              Create test orders, review statuses, and explore explainable
              transaction insights in one workspace.
            </p>
          </div>

          <div className="banner-symbol" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="symbol-core">P</div>
            <span className="spark spark-one">+ </span>
            <span className="spark spark-two">* </span>
          </div>
        </section>

        <section className="metrics-grid">
          <article className="metric-card">
            <div className="metric-top">
              <span>Total saved orders</span>
              <span className="metric-icon purple">&gt;</span>
            </div>
            <div className="metric-value">{transactions.length}</div>
            <div className="metric-foot">Loaded from backend order history</div>
          </article>

          <article className="metric-card">
            <div className="metric-top">
              <span>Order value created</span>
              <span className="metric-icon blue">$</span>
            </div>
            <div className="metric-value">{formatMoney(totalCreated)}</div>
            <div className="metric-foot">Not necessarily captured or settled</div>
          </article>

          <article className="metric-card">
            <div className="metric-top">
              <span>Completed orders</span>
              <span className="metric-icon green">OK</span>
            </div>
            <div className="metric-value">{completed.length}</div>
            <div className="metric-foot">Based on returned order status</div>
          </article>

          <article className="metric-card">
            <div className="metric-top">
              <span>Not marked completed</span>
              <span className="metric-icon amber">!</span>
            </div>
            <div className="metric-value">{pending}</div>
            <div className="metric-foot">
              May include created or approved orders
            </div>
          </article>
        </section>

        <div className="content-grid">
          <section className="panel create-panel">
            <div className="panel-heading">
              <div>
                <div className="section-kicker">PAYPAL SANDBOX</div>
                <h3>Create a payment</h3>
                <p>Generate a test order and continue to PayPal checkout.</p>
              </div>
              <div className="panel-icon">+</div>
            </div>

            <label htmlFor="amount">Payment amount (USD)</label>
            <div className="amount-input">
              <span>$</span>
              <input
                id="amount"
                type="number"
                min="0.01"
                max="10000"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="10.00"
              />
              <span className="currency-tag">USD</span>
            </div>

            <div className="helper-text">
              Minimum $0.01 - Maximum $10,000.00
            </div>

            {error && (
              <div className="message error-message" role="alert">
                {error}
              </div>
            )}

            {notice && (
              <div className="message success-message" role="status">
                {notice}
              </div>
            )}

            <button
              className="primary-button"
              onClick={createPayment}
              disabled={loading || health !== "connected"}
            >
              {loading ? "Creating order..." : "Create Sandbox payment"}
              {!loading && <span>...</span>}
            </button>

            <div className="secure-note">
              <span>&quot;</span>
              Test environment only. No live payment is initiated by this app.
            </div>
          </section>

          <section className="panel insights-panel">
            <div className="panel-heading">
              <div>
                <div className="section-kicker">PROTOTYPE FEATURE</div>
                <h3>AI insights</h3>
                <p>Example monitoring ideas for future development.</p>
              </div>
              <div className="ai-icon">AI</div>
            </div>

            <div className="insight-item">
              <div className="insight-symbol purple">!</div>
              <div>
                <strong>Transaction monitoring</strong>
                <p>Highlight unusual amounts or repeated order attempts.</p>
              </div>
              <span className="planned-tag">PLANNED</span>
            </div>

            <div className="insight-item">
              <div className="insight-symbol blue">?</div>
              <div>
                <strong>Payment status tracking</strong>
                <p>Separate created, approved, and completed orders.</p>
              </div>
              <span className="planned-tag">PLANNED</span>
            </div>

            <div className="insight-disclaimer">
              <span>&quot;</span>
              These are proposed features, not live AI analysis or fraud detection.
            </div>
          </section>
        </div>

        <section className="panel transactions-panel">
          <div className="transactions-heading">
            <div>
              <h3>Recent orders</h3>
              <p>Order history saved in the backend database.</p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <button
                type="button"
                onClick={refreshOrders}
                disabled={refreshing || health !== "connected"}
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "1px solid #d1d5db",
                  cursor: refreshing ? "wait" : "pointer",
                  background: "#ffffff",
                  color: "#374151",
                }}
              >
                {refreshing ? "Refreshing..." : "Refresh orders"}
              </button>

              <span className="session-tag">SAVED HISTORY</span>
            </div>
          </div>

          {health === "checking" ? (
            <div className="empty-state">
              <strong>Loading saved order history...</strong>
            </div>
          ) : health === "offline" ? (
            <div className="empty-state">
              <strong>Unable to connect to the backend</strong>
              <p>Start FastAPI and refresh the page to try again.</p>
            </div>
          ) : transactions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">&lt;&gt;</div>
              <strong>No saved orders found</strong>
              <p>Create a Sandbox payment above to add a test order.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ORDER ID</th>
                    <th>CREATED</th>
                    <th>AMOUNT</th>
                    <th>STATUS</th>
                    <th>PAYPAL</th>
                  </tr>
                </thead>
     <tbody>
  {transactions.map((transaction) => {
    const paypal = verificationStatus[transaction.id];

    return (
      <tr key={transaction.id}>
      <td className="order-id">{transaction.id}</td>

      <td>{transaction.createdAt}</td>

      <td className="amount-cell">
        {formatMoney(transaction.amount)}
      </td>

      <td>
        <span
          className={`order-status ${transaction.status.toLowerCase()}`}
        >
          {transaction.status}
        </span>
      </td>

      <td>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "8px",
            minWidth: "180px",
            fontSize: "12px",
          }}
        >
          {paypal?.verification === "verified" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                overflowWrap: "anywhere",
              }}
            >
              <span style={{ color: "#2563eb" }}>
                <strong>PayPal order status:</strong>{" "}
                {paypal.orderStatus}
              </span>

              <span
                style={{
                  color:
                    paypal.captureStatus === "COMPLETED"
                      ? "#15803d"
                      : paypal.captureStatus === "PENDING"
                        ? "#b45309"
                        : "#6b7280",
                  fontWeight: 600,
                }}
              >
                <strong>Capture status:</strong>{" "}
                {paypal.captureStatus}
                {paypal.captureStatus === "PENDING"
                  ? "- Under review"
                  : paypal.captureStatus === "COMPLETED"
                    ? "- Capture completed"
                    : ""}
              </span>

              {paypal.captureReason && (
                <span style={{ color: "#92400e" }}>
                  <strong>Review reason:</strong>{" "}
                  {paypal.captureReason}
                </span>
              )}

              {paypal.captureId && (
                <span style={{ color: "#6b7280" }}>
                  <strong>Capture ID:</strong> {paypal.captureId}
                </span>
              )}
            </div>
          )}

          {paypal?.verification === "missing" && (
            <span role="status" style={{ color: "#b45309" }}>
              PayPal order could not be verified. Saved history retained.
            </span>
          )}

          {paypal?.verification === "error" && (
            <span role="status" style={{ color: "#6b7280" }}>
              PayPal status <div style={{
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  overflowWrap: "anywhere",
  lineHeight: 1.5,
}}>
  <span style={{ color: "#2563eb" }}>
    <strong>PayPal order status:</strong>{" "}
    {paypal.orderStatus}
  </span>

  <span style={{
    color: paypal.captureStatus === "COMPLETED"
      ? "#15803d"
      : paypal.captureStatus === "PENDING"
        ? "#b45309"
        : "#6b7280",
    fontWeight: 600,
  }}>
    <strong>Capture status:</strong>{" "}
    {paypal.captureStatus}
    {paypal.captureStatus === "PENDING"
      ? "- Under review"
      : paypal.captureStatus === "COMPLETED"
        ? "- Capture completed"
        : ""}
  </span>

  {paypal.captureReason && (
    <span style={{ color: "#92400e" }}>
      <strong>Review reason:</strong>{" "}
      {paypal.captureReason}
    </span>
  )}

  {paypal.captureId && (
    <span style={{ color: "#6b7280" }}>
      <strong>Capture ID:</strong>{" "}
      {paypal.captureId}
    </span>
  )}
</div>
            </span>
          )}

          {!paypal && (
            <span style={{ color: "#6b7280" }}>
              Status not checked yet.
            </span>
          )}

          {transaction.approvalUrl ? (
            <a
              className="text-link"
              href={transaction.approvalUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open checkout {"->"}
            </a>
          ) : (
            <span style={{ color: "#6b7280" }}>No checkout link</span>
          )}
        </div>
      </td>
      </tr>
    );
  })}
</tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="app-footer">
          <span>&quot;</span>
          <span>
            <span className="status-dot" /> PayPal Sandbox environment
          </span>
        </footer>
      </main>
    </div>
  );
}

export default App;

