"use client";

import { useState, useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  FileSpreadsheet,
  Sheet,
  Table2,
  Lock,
  LogOut,
  Loader2,
} from "lucide-react";
import Link from "next/link";

interface SheetFile {
  id: string;
  name: string;
  modifiedTime: string;
}

interface SheetData {
  sheetNames: string[];
  activeSheet: string;
  values: string[][];
}

export default function ProgDash() {
  const { data: session, status } = useSession();
  const [sheets, setSheets] = useState<SheetFile[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState<SheetFile | null>(null);
  const [tabNames, setTabNames] = useState<string[]>([]);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [sheetData, setSheetData] = useState<SheetData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch sheets list when authenticated
  useEffect(() => {
    if (status === "authenticated") {
      fetchSheets();
    }
  }, [status]);

  async function fetchSheets() {
    setLoadingSheets(true);
    setError(null);
    try {
      const res = await fetch("/api/sheets/list");
      if (!res.ok) throw new Error("Failed to load sheets");
      const data = await res.json();
      setSheets(data.sheets);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoadingSheets(false);
    }
  }

  async function selectSheet(sheet: SheetFile) {
    setSelectedSheet(sheet);
    setLoadingTabs(true);
    setError(null);
    try {
      const res = await fetch(`/api/sheets/${sheet.id}`);
      if (!res.ok) throw new Error("Failed to load sheet tabs");
      const data = await res.json();
      setTabNames(data.sheetNames);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoadingTabs(false);
    }
  }

  async function selectTab(tabName: string) {
    if (!selectedSheet) return;
    setLoadingData(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sheets/${selectedSheet.id}?sheet=${encodeURIComponent(tabName)}`
      );
      if (!res.ok) throw new Error("Failed to load sheet data");
      const data = await res.json();
      setSheetData(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoadingData(false);
    }
  }

  const isLoading = status === "loading";

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link
            href="/#projects"
            className="flex items-center gap-2 text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft size={18} />
            <span className="text-sm hidden sm:inline">Back</span>
          </Link>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <FileSpreadsheet size={20} className="text-green-500" />
            ProgDash
          </h1>
          {session ? (
            <button
              onClick={() => signOut()}
              className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          ) : (
            <div className="w-16" />
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-4 sm:py-6">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="text-center mb-6 sm:mb-8"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-500/10 border border-green-500/20 mb-4">
            <FileSpreadsheet size={32} className="text-green-500" />
          </div>
          <p className="text-muted text-sm sm:text-base max-w-md mx-auto">
            Load your powerlifting program from Google Sheets into a clean,
            readable training view.
          </p>
        </motion.div>

        {/* How it works steps */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="mb-6 sm:mb-8"
        >
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                icon: Lock,
                label: "Sign In",
                desc: "Google OAuth",
                active: status === "authenticated",
              },
              {
                icon: Sheet,
                label: "Pick Tab",
                desc: "Choose a sheet tab",
                active: !!sheetData,
              },
              {
                icon: Table2,
                label: "View Data",
                desc: "Raw sheet data",
                active: !!sheetData,
              },
            ].map((step) => (
              <div
                key={step.label}
                className={`text-center p-3 sm:p-4 rounded-xl border transition-colors ${
                  step.active
                    ? "bg-green-500/5 border-green-500/30"
                    : "bg-card border-border"
                }`}
              >
                <div
                  className={`inline-flex items-center justify-center w-10 h-10 rounded-lg mb-2 ${
                    step.active ? "bg-green-500/20" : "bg-green-500/10"
                  }`}
                >
                  <step.icon
                    size={18}
                    className={
                      step.active ? "text-green-400" : "text-green-500"
                    }
                  />
                </div>
                <div className="text-xs sm:text-sm font-medium">
                  {step.label}
                </div>
                <div className="text-xs text-muted mt-0.5">{step.desc}</div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Privacy notice */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.12 }}
          className="mb-6 sm:mb-8"
        >
          <div className="p-3 sm:p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500/10 shrink-0">
                <Lock size={14} className="text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-blue-400">Your data is safe</div>
                <div className="text-xs text-muted mt-0.5">
                  Read-only access. No data stored. Your sheets stay yours.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2.5 ml-11 text-xs">
              <Link
                href="/projects/progdash/privacy"
                className="text-blue-400 underline underline-offset-2 hover:text-blue-300 transition-colors"
              >
                Privacy Policy
              </Link>
              <span className="text-border">|</span>
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 underline underline-offset-2 hover:text-blue-300 transition-colors"
              >
                Revoke Access
              </a>
            </div>
          </div>
        </motion.div>

        {/* Auth / Sheet Picker / Tab Picker / Data */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-muted" />
          </div>
        ) : !session ? (
          /* Sign in button */
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 }}
          >
            <button
              onClick={() => signIn("google")}
              className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-white rounded-xl font-medium text-gray-700 border border-gray-200 shadow-sm hover:shadow-md hover:bg-gray-50 transition-all cursor-pointer"
            >
              <svg width="20" height="20" viewBox="0 0 48 48">
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.003 24.003 0 0 0 0 21.56l7.98-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
              </svg>
              Sign in with Google
            </button>
            <p className="text-center text-xs text-muted mt-2 flex items-center justify-center gap-1">
              <Lock size={12} />
              Read-only access to your Google Sheets
            </p>
          </motion.div>
        ) : (
          /* Authenticated content */
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Error */}
            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Step 1: Spreadsheet picker */}
            {!selectedSheet && (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-border">
                  <h3 className="font-semibold text-sm sm:text-base flex items-center gap-2">
                    <FileSpreadsheet size={16} className="text-green-500" />
                    Your Spreadsheets
                  </h3>
                  <p className="text-xs text-muted mt-0.5">
                    Select a spreadsheet
                  </p>
                </div>

                {loadingSheets ? (
                  <div className="flex justify-center py-8">
                    <Loader2
                      size={20}
                      className="animate-spin text-muted"
                    />
                  </div>
                ) : sheets.length === 0 ? (
                  <div className="px-4 py-8 text-center text-muted text-sm">
                    No spreadsheets found in your Google Drive.
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    {sheets.map((sheet) => (
                      <button
                        key={sheet.id}
                        onClick={() => selectSheet(sheet)}
                        className="w-full text-left px-4 sm:px-5 py-3 hover:bg-background/50 transition-colors border-b border-border/50 last:border-b-0 flex items-center gap-3 cursor-pointer"
                      >
                        <FileSpreadsheet
                          size={16}
                          className="text-green-500 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">
                            {sheet.name}
                          </div>
                          <div className="text-xs text-muted">
                            {new Date(
                              sheet.modifiedTime
                            ).toLocaleDateString()}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Tab picker */}
            {selectedSheet && !sheetData && !loadingData && (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sm sm:text-base flex items-center gap-2">
                        <Sheet size={16} className="text-green-500" />
                        {selectedSheet.name}
                      </h3>
                      <p className="text-xs text-muted mt-0.5">
                        Select a tab to load ({tabNames.length} tabs)
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedSheet(null);
                        setTabNames([]);
                      }}
                      className="text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
                    >
                      Change
                    </button>
                  </div>
                </div>

                {loadingTabs ? (
                  <div className="flex justify-center py-8">
                    <Loader2
                      size={20}
                      className="animate-spin text-muted"
                    />
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    {tabNames.map((tab) => (
                      <button
                        key={tab}
                        onClick={() => selectTab(tab)}
                        className="w-full text-left px-4 sm:px-5 py-3 hover:bg-background/50 transition-colors border-b border-border/50 last:border-b-0 flex items-center gap-3 cursor-pointer"
                      >
                        <Sheet
                          size={14}
                          className="text-green-500 shrink-0"
                        />
                        <span className="text-sm">{tab}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Loading sheet data */}
            {loadingData && (
              <div className="flex justify-center py-12">
                <Loader2 size={24} className="animate-spin text-muted" />
              </div>
            )}

            {/* Step 3: Sheet data display */}
            {sheetData && !loadingData && (
              <div>
                {/* Sheet header with back button */}
                <div className="flex items-center justify-between mb-4">
                  <button
                    onClick={() => setSheetData(null)}
                    className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer"
                  >
                    <ArrowLeft size={14} />
                    Back to tabs
                  </button>
                  <span className="text-xs text-muted">
                    {sheetData.values.length} rows
                  </span>
                </div>

                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-4 sm:px-5 py-3 border-b border-border flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sm sm:text-base">
                        {selectedSheet?.name}
                      </h3>
                      <p className="text-xs text-muted">
                        Tab: {sheetData.activeSheet}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 text-xs font-medium bg-green-500/10 text-green-500 rounded border border-green-500/20">
                      Live
                    </span>
                  </div>

                  {/* Raw data table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      {sheetData.values.length > 0 && (
                        <>
                          <thead>
                            <tr className="border-b border-border bg-background/50">
                              {sheetData.values[0].map((header, i) => (
                                <th
                                  key={i}
                                  className="text-left px-4 py-2.5 text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap"
                                >
                                  {header}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sheetData.values.slice(1).map((row, rowIdx) => (
                              <tr
                                key={rowIdx}
                                className={`border-b border-border/50 ${
                                  rowIdx % 2 === 0 ? "" : "bg-background/30"
                                }`}
                              >
                                {sheetData.values[0].map((_, colIdx) => (
                                  <td
                                    key={colIdx}
                                    className="px-4 py-2.5 whitespace-nowrap"
                                  >
                                    {row[colIdx] ?? ""}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </>
                      )}
                    </table>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Tech stack */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.25 }}
          className="mt-6 flex flex-wrap justify-center gap-2"
        >
          {[
            "Next.js",
            "TypeScript",
            "Google OAuth",
            "Google Sheets API",
            "Tailwind",
          ].map((tech) => (
            <span
              key={tech}
              className="px-2.5 py-1 text-xs font-medium bg-card text-muted rounded-lg border border-border"
            >
              {tech}
            </span>
          ))}
        </motion.div>

      </div>
    </main>
  );
}
