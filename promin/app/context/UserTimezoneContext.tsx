"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { supabase } from "../lib/supabaseClient";

type UserTimezoneContextValue = {
  timezone: string;
  setTimezone: (tz: string) => Promise<void>;
  /** "Today" as a Date in the user's timezone (midnight) */
  userToday: Date;
};

const UserTimezoneContext = createContext<UserTimezoneContextValue>({
  timezone: "UTC",
  setTimezone: async () => {},
  userToday: new Date(),
});

export function UserTimezoneProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [timezone, setTimezoneState] = useState("UTC");

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("id", user.id)
        .single();
      if (data?.timezone) setTimezoneState(data.timezone);
    }
    load();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) load();
      else setTimezoneState("UTC");
    });

    return () => subscription.unsubscribe();
  }, []);

  const setTimezone = useCallback(async (tz: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("profiles").update({ timezone: tz }).eq("id", user.id);
    setTimezoneState(tz);
  }, []);

  // Compute "today" in the user's timezone
  const userToday = useMemo(() => {
    const now = new Date();
    // en-CA locale gives YYYY-MM-DD format
    const dateStr = now.toLocaleDateString("en-CA", { timeZone: timezone });
    return new Date(dateStr + "T00:00:00");
  }, [timezone]);

  return (
    <UserTimezoneContext.Provider value={{ timezone, setTimezone, userToday }}>
      {children}
    </UserTimezoneContext.Provider>
  );
}

export function useUserTimezone() {
  return useContext(UserTimezoneContext);
}
