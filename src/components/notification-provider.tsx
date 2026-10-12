"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import {
  createNotificationPolling,
  type NotificationSnapshot,
} from "@/lib/notification-polling";
import { markAllReadAction, markReadAction } from "@/app/actions/notifications";

type NotificationContextValue = NotificationSnapshot & {
  refresh: () => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

/** One polling owner per dashboard session; consumers never create timers. */
export default function NotificationProvider({
  initialUnread,
  children,
}: {
  initialUnread: number;
  children: React.ReactNode;
}) {
  const [polling] = useState(() => createNotificationPolling(initialUnread, {
    fetchSnapshot: async (signal) => {
      const response = await fetch("/api/notifications?limit=8", { cache: "no-store", signal });
      return response.ok ? await response.json() as NotificationSnapshot : null;
    },
    isVisible: () => document.visibilityState === "visible",
    onVisibilityChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (id) => window.clearInterval(id as number),
  }));
  const snapshot = useSyncExternalStore(polling.subscribe, polling.getSnapshot, polling.getServerSnapshot);

  useEffect(() => polling.start(), [polling]);

  async function markRead(ids: string[]) {
    polling.markRead(ids);
    try {
      await markReadAction(ids);
    } catch {
      // Reconcile failed mutations too, so optimistic badges do not stay stale.
    } finally {
      await polling.reconcile();
    }
  }

  async function markAllRead() {
    polling.markRead();
    try {
      await markAllReadAction();
    } catch {
      // Restore the authoritative state if the mutation failed.
    } finally {
      await polling.reconcile();
    }
  }

  return (
    <NotificationContext.Provider value={{ ...snapshot, refresh: polling.refresh, markRead, markAllRead }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotifications requires NotificationProvider");
  return context;
}
