import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { subscribeAuth } from "../services/auth.service";
import { subscribeUserProfile } from "../services/users.service";
import { STORE_ID } from "../services/categories.service";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null);

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [checkingProfile, setCheckingProfile] = useState(false);

  useEffect(() => {
    const unsubscribeAuth = subscribeAuth((currentUser) => {
      setFirebaseUser(currentUser);
      setProfile(null);
      setCheckingAuth(false);

      if (currentUser) {
        setCheckingProfile(true);
      } else {
        setCheckingProfile(false);
      }
    });

    return () => {
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    if (!firebaseUser?.uid) return;

    const unsubscribeProfile = subscribeUserProfile(
      firebaseUser.uid,
      (profileData) => {
        setProfile(profileData);
        setCheckingProfile(false);
      },
      () => {
        setProfile(null);
        setCheckingProfile(false);
      }
    );

    return () => {
      unsubscribeProfile();
    };
  }, [firebaseUser?.uid]);

  const loading = checkingAuth || checkingProfile;

  const isAuthenticated = Boolean(firebaseUser);
  const hasProfile = Boolean(profile);
  const isActive = Boolean(profile?.active);
  const belongsToStore = profile?.storeId === STORE_ID;

  const role = profile?.role || "";

  const isAdmin = role === "admin";
  const isSeller = role === "seller";

  const canAccessPanel =
    isAuthenticated && hasProfile && isActive && belongsToStore;

  const value = useMemo(
    () => ({
      firebaseUser,
      profile,
      loading,

      isAuthenticated,
      hasProfile,
      isActive,
      belongsToStore,

      role,
      isAdmin,
      isSeller,
      canAccessPanel,
    }),
    [
      firebaseUser,
      profile,
      loading,
      isAuthenticated,
      hasProfile,
      isActive,
      belongsToStore,
      role,
      isAdmin,
      isSeller,
      canAccessPanel,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth debe usarse dentro de AuthProvider.");
  }

  return context;
}