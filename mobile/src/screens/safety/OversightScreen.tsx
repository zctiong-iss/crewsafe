/**
 * What a safety manager oversees: every site, and the plans drafted for each (SCRUM-TBD-90).
 *
 * ── WHY SITE → PLANS, AND NOT SITE → SUPERVISOR → PLANS ─────────────────────────────────
 * Grouping plans under the supervisor who owns them was the original ask, and the data does
 * not support it. `Shift` carries no `createdBy`; `Recommendation` names only its `shiftId`.
 * The single piece of supervisor identity anywhere is `approval.approverId`, which exists
 * only AFTER a decision — so a plan awaiting one, the thing a manager most needs to see, has
 * nobody to file it under. Worse, since SCRUM-291 most plans are drafted by the scheduler and
 * have no human author at all, so the majority would land in a "system" bucket.
 *
 * The supervisor appears as a badge on the plans that HAVE been decided, and is absent on the
 * ones that have not. That is the honest shape of the data rather than a compromise.
 *
 * ── BUILT FOR TWENTY SITES, NOT FOR THREE ───────────────────────────────────────────────
 * A manager may hold twenty site memberships or more, which drives three decisions here:
 *
 *   `FlatList`, not a `ScrollView` with `.map`. Twenty sites each holding a plan list is the
 *   difference between a screen that opens and one that stutters on a mid-range phone.
 *
 *   Plans load on EXPAND, never up front. One site costs a `fetchShifts` plus one call per
 *   shift; doing that for twenty on mount is ~120 requests to render a list of names.
 *
 *   Sites sort by what needs attention. Alphabetical would make a manager read all twenty to
 *   find the one that matters, which is the opposite of triage.
 *
 * @author Justin Chua
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppLoader from "@/components/feedback/AppLoader";
import MessageBanner from "@/components/feedback/MessageBanner";
import Disclosure from "@/components/common/Disclosure";
import Pill from "@/components/common/Pill";
import RecommendationStatusPill from "@/components/recommendations/RecommendationStatusPill";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  awaitingDecisionCount,
  loadOversightSites,
  loadSitePlans,
  type SitePlans,
} from "@/store/reducers/oversightSlice";
import { formatDateTime } from "@/helpers/dateTime";
import { sharedPaddingHorizontal, sharedGap, cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";
import type { Recommendation, Site } from "@/types/domain";

/** One plan, as a manager reads it: what it is, who decided it, when it was drafted. */
function PlanRow({
  plan,
  deciderName,
}: Readonly<{ plan: Recommendation; deciderName: string | null }>) {
  const { t, i18n } = useTranslation();

  return (
    <View style={styles.planRow}>
      <View style={styles.planPills}>
        <RecommendationStatusPill
          status={plan.status}
          decision={plan.approval?.decision ?? null}
        />
        {/*
          The supervisor, as an ENTITY pill (ADR-0017 §4): it names an identity, so it takes
          the neutral fill and the always-on border and never a semantic colour. A person's
          name must not render in hazard red because of the status sitting beside it.

          Absent when nobody has decided. A pending plan genuinely has no owner, and a badge
          there would be the screen asserting something the data does not say.
        */}
        {deciderName ? <Pill role="entity" label={deciderName} /> : null}
      </View>

      <AppText variant="caption" tone="secondary" style={styles.planMeta}>
        {t("recommendations.draftedAt", {
          time: formatDateTime(plan.createdAt, i18n.language),
        })}
      </AppText>
    </View>
  );
}

/** The expandable contents of one site: its plans, or why there are none to show. */
function SitePlanList({
  plans,
  workerNameFor,
}: Readonly<{ plans: SitePlans | undefined; workerNameFor: (id: string) => string | null }>) {
  const { t } = useTranslation();

  if (!plans || plans.status === "loading") {
    return (
      <View style={styles.siteBody}>
        <AppLoader />
      </View>
    );
  }

  if (plans.status === "error") {
    // Scoped to this row on purpose: one site failing must leave the other nineteen readable.
    return (
      <View style={styles.siteBody}>
        <MessageBanner message={t(plans.errorKey ?? "errors.unknown")} tone="danger" />
      </View>
    );
  }

  if (plans.items.length === 0) {
    return (
      <View style={styles.siteBody}>
        <AppText variant="caption" tone="secondary">
          {t("oversight.noPlans")}
        </AppText>
      </View>
    );
  }

  return (
    <View style={styles.siteBody}>
      {plans.items.map((plan) => (
        <PlanRow
          key={plan.id}
          plan={plan}
          deciderName={
            plan.approval ? (workerNameFor(plan.approval.approverId) ?? plan.approval.approverId) : null
          }
        />
      ))}
    </View>
  );
}

export default function OversightScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();

  const user = useAppSelector((state) => state.auth.user);
  const { sites, status, errorKey, refreshing, plansBySite } = useAppSelector(
    (state) => state.oversight,
  );
  const workers = useAppSelector((state) => state.shifts.workers);

  /*
   * Which sites are open, held HERE rather than inside each `Disclosure`.
   *
   * The rows live in a `FlatList`, which unmounts them on scroll — a self-stateful disclosure
   * would forget what a manager had open the moment they scrolled past and back. Same reason
   * `ShiftListScreen` keeps its crew expansion in a Set on the screen.
   */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const siteIds = useMemo(() => user?.siteIds ?? [], [user?.siteIds]);

  const load = useCallback(
    (isRefresh: boolean) => {
      if (siteIds.length === 0) return;
      void dispatch(loadOversightSites({ siteIds, refreshing: isRefresh }));
    },
    [dispatch, siteIds],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const workerNameFor = useCallback(
    (workerId: string) => workers.find((w) => w.id === workerId)?.displayName ?? null,
    [workers],
  );

  const toggleSite = useCallback(
    (siteId: string) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(siteId)) {
          next.delete(siteId);
        } else {
          next.add(siteId);
          // Fetched once, on first expand. Re-expanding a site already loaded is instant,
          // because collapsing a row is a display change and not a reason to discard work.
          if (!plansBySite[siteId]) void dispatch(loadSitePlans({ siteId }));
        }
        return next;
      });
    },
    [dispatch, plansBySite],
  );

  /*
   * Ordered by what needs attention, not alphabetically.
   *
   * With twenty sites, alphabetical ordering means reading all twenty to find the one with a
   * decision outstanding. Sites with plans awaiting a decision rise; ties break by name so the
   * order does not shuffle between refreshes, which would move a row under a manager's thumb.
   *
   * A site nobody has expanded counts zero, because nothing has been fetched for it yet — the
   * ordering sharpens as the screen is used rather than being wrong before then.
   */
  const ordered = useMemo(() => {
    return [...sites].sort((a, b) => {
      const byAwaiting =
        awaitingDecisionCount(plansBySite[b.id]) - awaitingDecisionCount(plansBySite[a.id]);
      return byAwaiting !== 0 ? byAwaiting : a.name.localeCompare(b.name);
    });
  }, [sites, plansBySite]);

  if (status === "loading" && sites.length === 0) {
    return (
      <AppSafeView>
        <AppLoader />
      </AppSafeView>
    );
  }

  if (siteIds.length === 0) {
    // Reachable: a manager can exist with no memberships. A blank screen would read as a bug.
    return (
      <AppSafeView>
        <View style={styles.empty}>
          <AppText variant="title" style={styles.emptyTitle}>
            {t("shifts.noSitesTitle")}
          </AppText>
          <AppText variant="body" tone="secondary" style={styles.emptyBody}>
            {t("shifts.noSitesBody")}
          </AppText>
        </View>
      </AppSafeView>
    );
  }

  const renderSite = ({ item }: { item: Site }) => {
    const plans = plansBySite[item.id];
    const awaiting = awaitingDecisionCount(plans);

    return (
      <View
        style={[
          styles.card,
          cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
          { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
        ]}
      >
        <View style={styles.siteHeader}>
          <AppText variant="subtitle" style={styles.siteName}>
            {item.name}
          </AppText>
          {/*
            A state pill, filled, only when something is actually waiting on a decision — the
            one thing on this row asking for action. A site with nothing outstanding shows no
            pill rather than a "0", which would read as a signal where there is none.
          */}
          {awaiting > 0 ? (
            <Pill
              role="state"
              tone="warning"
              label={t("oversight.awaitingCount", { count: awaiting })}
            />
          ) : null}
        </View>

        <Disclosure
          open={expanded.has(item.id)}
          onToggle={() => toggleSite(item.id)}
          label={(open) => (open ? t("oversight.hidePlans") : t("oversight.showPlans"))}
          accessibilityLabel={(open) =>
            open
              ? t("oversight.hidePlansFor", { site: item.name })
              : t("oversight.showPlansFor", { site: item.name })
          }
          style={styles.siteToggle}
        >
          <SitePlanList plans={plans} workerNameFor={workerNameFor} />
        </Disclosure>
      </View>
    );
  };

  return (
    <AppSafeView>
      <FlatList
        data={ordered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        /* The expansion Set is not part of `data`, and FlatList is a PureComponent — without
           this a row would not re-render when it opened. Same reason ShiftListScreen does it. */
        extraData={`${[...expanded].join(",")}|${Object.keys(plansBySite).length}`}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
        ListHeaderComponent={
          errorKey ? (
            <MessageBanner message={t(errorKey)} tone="danger" />
          ) : null
        }
        renderItem={renderSite}
      />
    </AppSafeView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: sharedPaddingHorizontal,
    paddingVertical: vs(12),
    // The container owns the spacing between cards, so a card never carries a root margin.
    gap: sharedGap,
  },
  card: {
    padding: s(14),
  },
  siteHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: s(8),
  },
  siteName: {
    // Wraps rather than pushing the count pill off the edge: site names are free text and
    // grow further at large text sizes.
    flexShrink: 1,
  },
  siteToggle: {
    justifyContent: "space-between",
    marginTop: vs(6),
  },
  siteBody: {
    marginTop: vs(8),
    gap: vs(10),
  },
  planRow: {
    paddingTop: vs(8),
  },
  planPills: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: s(6),
  },
  planMeta: {
    marginTop: vs(4),
  },
  empty: {
    alignItems: "center",
    paddingVertical: vs(32),
    paddingHorizontal: sharedPaddingHorizontal,
  },
  emptyTitle: {
    textAlign: "center",
  },
  emptyBody: {
    textAlign: "center",
    marginTop: vs(8),
  },
});
