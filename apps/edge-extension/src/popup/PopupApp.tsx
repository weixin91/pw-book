import React, { useEffect, useState } from "react";
import { VaultList } from "./components/VaultList";
import { UnlockScreen } from "./components/UnlockScreen";
import { CipherForm } from "./components/CipherForm";
import { PasswordGenerator } from "./components/PasswordGenerator";
import { CookieSyncPanel } from "./components/CookieSyncPanel";
import { NoteForm } from "./components/NoteForm";
import { TrashView } from "./components/TrashView";
import { StorageService } from "../platform/storage";

type View = "unlock" | "vault" | "add" | "edit" | "noteAdd" | "noteEdit" | "generator" | "cookieSync" | "trash";

export function PopupApp(): React.ReactElement {
  const [view, setView] = useState<View>("unlock");
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => {
    checkLoginStatus();
  }, []);

  async function checkLoginStatus() {
    const key = await StorageService.getUserKey();
    setView(key ? "vault" : "unlock");
  }

  function handleUnlocked() {
    setView("vault");
  }

  function handleAdd() {
    setEditId(null);
    setView("add");
  }

  function handleEdit(id: string) {
    setEditId(id);
    setView("edit");
  }

  function handleAddNote() {
    setEditId(null);
    setView("noteAdd");
  }

  function handleEditNote(id: string) {
    setEditId(id);
    setView("noteEdit");
  }

  function handleBackToVault() {
    setView("vault");
  }

  function handleOpenGenerator() {
    setView("generator");
  }

  function handleOpenCookieSync() {
    setView("cookieSync");
  }

  function handleOpenTrash() {
    setView("trash");
  }

  return (
    <div style={{ width: 360, minHeight: 480, fontFamily: "system-ui, sans-serif" }}>
      {view === "unlock" && <UnlockScreen onUnlocked={handleUnlocked} />}
      {view === "vault" && (
        <VaultList
          onAdd={handleAdd}
          onEdit={handleEdit}
          onAddNote={handleAddNote}
          onEditNote={handleEditNote}
          onOpenGenerator={handleOpenGenerator}
          onOpenCookieSync={handleOpenCookieSync}
          onOpenTrash={handleOpenTrash}
        />
      )}
      {(view === "add" || view === "edit") && (
        <CipherForm
          editId={editId}
          onBack={handleBackToVault}
          onSaved={handleBackToVault}
          onDeleted={handleBackToVault}
        />
      )}
      {(view === "noteAdd" || view === "noteEdit") && (
        <NoteForm
          editId={editId}
          onBack={handleBackToVault}
          onSaved={handleBackToVault}
          onDeleted={handleBackToVault}
        />
      )}
      {view === "generator" && (
        <PasswordGenerator onBack={handleBackToVault} />
      )}
      {view === "cookieSync" && (
        <div>
          <button onClick={handleBackToVault} style={{ margin: 8, padding: "4px 8px", fontSize: 13 }}>
            ← 返回
          </button>
          <CookieSyncPanel />
        </div>
      )}
      {view === "trash" && <TrashView onBack={handleBackToVault} />}
    </div>
  );
}
