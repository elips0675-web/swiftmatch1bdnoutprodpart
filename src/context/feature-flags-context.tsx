import React, { createContext, useContext, useMemo, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { getToken } from '@/lib/token';
import { getRolloutBucket, tokenUserId } from '@/lib/rollout';

export interface FeatureFlags {
  videoCallsEnabled: boolean;
  aiIcebreakersEnabled: boolean;
  aiCompatibilityEnabled: boolean;
  groupsPageEnabled: boolean;
  showAdsEnabled: boolean;
  hangoutsEnabled: boolean;
  partnerOffersEnabled: boolean;
  profileActivityEnabled: boolean;
  openingLinesEnabled: boolean;
  rolloutEnabled: boolean;
}

const defaultFlags: FeatureFlags = {
  videoCallsEnabled: true,
  aiIcebreakersEnabled: true,
  aiCompatibilityEnabled: true,
  groupsPageEnabled: true,
  showAdsEnabled: false,
  hangoutsEnabled: true,
  partnerOffersEnabled: false,
  profileActivityEnabled: true,
  openingLinesEnabled: true,
  rolloutEnabled: true,
};

const mapApiFlags = (data: Record<string, boolean>): FeatureFlags => ({
  videoCallsEnabled: data.videoCalls ?? true,
  aiIcebreakersEnabled: data.aiIcebreakers ?? true,
  aiCompatibilityEnabled: data.aiCompatibility ?? true,
  groupsPageEnabled: data.groupsPage ?? true,
  showAdsEnabled: data.showAds ?? false,
  hangoutsEnabled: data.hangouts ?? true,
  partnerOffersEnabled: data.partnerOffers ?? false,
  profileActivityEnabled: data.profileActivity ?? true,
  openingLinesEnabled: data.openingLines ?? true,
  rolloutEnabled: true,
});

const applyRollout = (data: Record<string, unknown>): FeatureFlags => {
  const raw = mapApiFlags(data as Record<string, boolean>)
  const rolloutPercent = typeof data.rolloutPercent === 'number' ? data.rolloutPercent : 100
  const rolloutEnabled = rolloutPercent >= 100 || getRolloutBucket(tokenUserId()) < rolloutPercent
  return {
    videoCallsEnabled: raw.videoCallsEnabled && rolloutEnabled,
    aiIcebreakersEnabled: raw.aiIcebreakersEnabled && rolloutEnabled,
    aiCompatibilityEnabled: raw.aiCompatibilityEnabled && rolloutEnabled,
    groupsPageEnabled: raw.groupsPageEnabled && rolloutEnabled,
    showAdsEnabled: raw.showAdsEnabled && rolloutEnabled,
    hangoutsEnabled: raw.hangoutsEnabled && rolloutEnabled,
    partnerOffersEnabled: raw.partnerOffersEnabled && rolloutEnabled,
    profileActivityEnabled: raw.profileActivityEnabled && rolloutEnabled,
    openingLinesEnabled: raw.openingLinesEnabled && rolloutEnabled,
    rolloutEnabled,
  }
}

const FeatureFlagsContext = createContext<FeatureFlags>(defaultFlags);

export const FeatureFlagsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [flags, setFlags] = useState<FeatureFlags>(defaultFlags);

  useEffect(() => {
    const supabase = getSupabase()
    const url = import.meta.env.VITE_SUPABASE_URL

    if (supabase && url && !url.includes('your-project.supabase.co')) {
      Promise.resolve(
        supabase
          .from('feature_flags')
          .select('*')
          .maybeSingle(),
      )
        .then(({ data }) => {
          if (data) {
            setFlags(prev => ({ ...prev, ...data }))
          }
        })
        .catch(() => {})
    } else {
      const token = getToken()
      fetch('/api/admin/features', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then(r => { if (!r.ok) throw new Error(); return r.json() })
        .then(data => setFlags(applyRollout(data)))
        .catch(() => {})
    }
  }, [])

  return (
    <FeatureFlagsContext.Provider value={flags}>
      {children}
    </FeatureFlagsContext.Provider>
  );
};

export const useFeatureFlags = () => {
  return useContext(FeatureFlagsContext);
};
