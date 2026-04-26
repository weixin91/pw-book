import React, { useEffect, useState } from "react";
import { VaultList } from "./components/VaultList";
import { UnlockScreen } from "./components/UnlockScreen";
import { CipherForm } from "./components/CipherForm";
import { PasswordGenerator } from "./components/PasswordGenerator";
import { StorageService } from "../platform/storage";

type View = "unlock" | "vault" | "add" | "edit" | "generator";

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

  function handleBackToVault() {
    setView("vault");
  }

  function handleOpenGenerator() {
    setView("generator");
  }

  return (
    <div style={{ width: 360, minHeight: 480, fontFamily: "system-ui, sans-serif" }}>
      {view === "unlock" && <UnlockScreen onUnlocked={handleUnlocked} />}
      {view === "vault" && (
        <VaultList
          onAdd={handleAdd}
          onEdit={handleEdit}
          onOpenGenerator={handleOpenGenerator}
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
      {view === "generator" && (
        <PasswordGenerator onBack={handleBackToVault} />
      )}
    </div>
  );
}
