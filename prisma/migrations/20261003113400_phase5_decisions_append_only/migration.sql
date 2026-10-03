-- Les décisions de validation sont un journal : l'application ne peut ni les modifier ni les supprimer.
REVOKE UPDATE, DELETE, TRUNCATE ON "ApprovalDecision" FROM afrigest_app;
