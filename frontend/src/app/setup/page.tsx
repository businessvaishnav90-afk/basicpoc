'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Database, ShieldAlert, LogIn, Settings } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '@/hooks/use-confirm';
import api from '@/lib/api';
import axios from 'axios';

export default function SetupPage() {
  const router = useRouter();
  const { confirm, ConfirmDialog } = useConfirm();
  const [loading, setLoading] = useState(false);

  const handleRestoreBackup = async () => {
    if (!window.electronAPI?.pickRestoreFile) {
      toast.error('Backup restoration is only available in the desktop application.');
      return;
    }
    setLoading(true);
    try {
      const picked = await window.electronAPI.pickRestoreFile();
      if (picked.canceled || !picked.path || !picked.token) {
        setLoading(false);
        return;
      }

      const fileName = picked.path.split(/[\\/]/).pop() || picked.path;
      const ok = await confirm(`Are you sure you want to restore "${fileName}"? This will overwrite the local store database.`, {
        title: 'Confirm Database Restore',
        confirmLabel: 'Restore Database',
        destructive: true,
      });
      if (!ok) {
        setLoading(false);
        return;
      }

      await api.post('/auth/setup/restore', {
        confirmation: 'RESTORE BACKUP',
        selection_token: picked.token,
      });
      toast.success('Database restored successfully. Redirecting to login...');
      setTimeout(() => router.replace('/auth/login'), 1500);
    } catch (error: unknown) {
      const detail = axios.isAxiosError(error)
        ? (error.response?.data as { error?: string } | undefined)?.error
        : error instanceof Error
          ? error.message
          : 'Failed to restore backup.';
      toast.error(detail || 'Failed to restore backup.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <img src="/logo.svg" alt="Flo" width={72} height={72} className="mx-auto mb-4" />
          <h1 className="text-2xl font-bold">Store Provisioning Required</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Local self-service owner registration has been retired from this client.
          </p>
        </div>

        <div
          data-testid="setup-restore-backup-callout"
          className="mb-6 flex flex-col gap-3 rounded-xl border border-primary/20 bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Database className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                Restore From Backup File
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Have a previous FloCafe database backup? Restore it directly.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            data-testid="setup-restore-backup-button"
            onClick={() => void handleRestoreBackup()}
            className="shrink-0 gap-2"
          >
            <span>Restore From Backup</span>
          </Button>
        </div>

        <Card className="border-border">
          <CardContent className="pt-6 space-y-6">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-900 dark:text-amber-300">
                  Managed Setup In Effect
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Store Owner accounts must be initialized through the separate Master Admin Portal or provided by the platform operator.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <Button
                type="button"
                className="w-full gap-2"
                size="lg"
                onClick={() => router.push('/auth/login')}
              >
                <LogIn className="w-4 h-4" />
                Go to Sign In (Existing Users)
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={() => router.push('/master-admin')}
              >
                <Settings className="w-4 h-4" />
                Open Master Admin Portal
              </Button>

              <div className="pt-2 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={loading}
                  data-testid="setup-restore-backup-button"
                  onClick={() => void handleRestoreBackup()}
                  className="w-full gap-2 text-muted-foreground hover:text-foreground"
                >
                  <Database className="w-4 h-4" />
                  Restore Disaster Recovery Backup (.db)
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      {ConfirmDialog}
    </div>
  );
}
