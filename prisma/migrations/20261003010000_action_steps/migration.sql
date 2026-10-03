CREATE TABLE "ActionStep" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actionId" TEXT NOT NULL REFERENCES "Action"("id") ON DELETE CASCADE,
  "text" TEXT NOT NULL,
  "points" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE "ActionStep" ADD CONSTRAINT "ActionStep_points_check" CHECK ("points" >= 0);
CREATE INDEX "ActionStep_actionId_sortOrder_idx" ON "ActionStep"("actionId","sortOrder");

CREATE TABLE "ActionStepCompletion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "actionId" TEXT NOT NULL REFERENCES "Action"("id"),
  "stepId" TEXT NOT NULL REFERENCES "ActionStep"("id"),
  "localDate" TEXT NOT NULL,
  "stepNameSnapshot" TEXT NOT NULL,
  "pointsAwarded" INTEGER NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversedAt" TIMESTAMP(3)
);
CREATE INDEX "ActionStepCompletion_userId_actionId_localDate_idx" ON "ActionStepCompletion"("userId","actionId","localDate");
CREATE UNIQUE INDEX "ActionStepCompletion_active_unique" ON "ActionStepCompletion"("userId","actionId","stepId","localDate") WHERE "reversedAt" IS NULL;
