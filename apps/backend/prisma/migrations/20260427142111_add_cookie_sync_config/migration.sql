-- CreateTable
CREATE TABLE "cookie_sync_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "autoPush" BOOLEAN NOT NULL DEFAULT false,
    "autoPull" BOOLEAN NOT NULL DEFAULT false,
    "includeLocalStorage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedAt" DATETIME NOT NULL,
    CONSTRAINT "cookie_sync_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_cookies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedAt" DATETIME NOT NULL,
    CONSTRAINT "cookies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_cookies" ("domain", "encryptedData", "id", "modifiedAt", "userId") SELECT "domain", "encryptedData", "id", "modifiedAt", "userId" FROM "cookies";
DROP TABLE "cookies";
ALTER TABLE "new_cookies" RENAME TO "cookies";
CREATE UNIQUE INDEX "cookies_userId_domain_key" ON "cookies"("userId", "domain");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "cookie_sync_configs_userId_domain_key" ON "cookie_sync_configs"("userId", "domain");
