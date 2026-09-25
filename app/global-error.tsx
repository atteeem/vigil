"use client";

/** Last-resort boundary (the root layout itself failed). Plain markup: the app shell is not available here. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#080a0d", color: "#e8ebef", fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <main style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 22 }}>Vigil could not be loaded</h1>
          <p style={{ opacity: 0.7 }}>Something went wrong on our side.</p>
          <button type="button" onClick={reset} style={{ marginTop: 16, padding: "10px 20px", borderRadius: 999, border: 0, fontWeight: 600 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
