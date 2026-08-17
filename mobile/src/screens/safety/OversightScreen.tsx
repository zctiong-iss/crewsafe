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
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
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
  loadPlanSummary,
  loadSitePlans,
  type SitePlans,
} from "@/store/reducers/oversightSlice";
import { useAutoRefresh, REFRESH_INTERVALS } from "@/hooks/useAutoRefresh";
import { formatDateTime } from "@/helpers/dateTime";
import { sharedPaddingHorizontal, sharedGap, cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";
import type { Recommendation, Site } from "@/types/domain";
import type { OversightStackParamList } from "@/navigation/types";
import type { SiteSupervisor } from "@/api/endpoints/oversight";

/**
 * One plan, as a manager reads it: what it is, who decided it, when it was drafted.
 *
 * Tapping opens the full plan. The row shows a status and a timestamp, which says a plan
 * exists and nothing about what it recommends — the mitigations, rationale and evidence a
 * manager needs to oversee a decision all live on the detail screen.
 *
 * ── WHY AN OUTLINE AND NOT A HOVER STATE ────────────────────────────────────────────────
 * Hover was the nicer idea and it is not available here. React Native implements
 * `onHoverIn`/`onHoverOut` on top of `onMouseEnter`/`onMouseLeave` — its own source says so —
 * so they need a pointer, and on a touch phone there is never one. They are wired up anyway
 * because they cost nothing and do work under `npm run web`, but they can never be the thing
 * that tells a supervisor on site that this row does something.
 *
 * So the affordance is a resting border. It is deliberately always visible rather than
 * appearing on interaction: an outline that only shows once you have already pressed answers
 * a question you asked by pressing, which is precisely what the chevron it replaced did not
 * require you to do.
 *
 * ── WHY A BORDER AND NOT A TINTED FILL ──────────────────────────────────────────────────
 * `surfaceAlt` is `#F6F6F6` normally and `#FFFFFF` in high contrast, so a fill-based
 * affordance disappears completely for the users least able to afford losing it.
 * `borderStrong` stays `#000000` in both themes.
 */
function PlanRow({
  plan,
  deciderName,
  supervisors,
  onPress,
}: Readonly<{
  plan: Recommendation;
  deciderName: string | null;
  /** The SITE's supervisors — accountability, not authorship. See `SiteSupervisor`. */
  supervisors: SiteSupervisor[];
  onPress: () => void;
}>) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  /*
   * Focus and hover share one flag because they mean the same thing to this row: "you are
   * about to act on me". Focus is the half that matters on a phone — it is what a switch
   * control or an external keyboard drives — and it is why this is not press-only.
   */
  const [highlighted, setHighlighted] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setHighlighted(true)}
      onBlur={() => setHighlighted(false)}
      onHoverIn={() => setHighlighted(true)}
      onHoverOut={() => setHighlighted(false)}
      accessibilityRole="button"
      /* Named by what it opens, not "plan row": a screen reader should say where the tap
         goes. The status is already announced by the pill beside it. */
      accessibilityLabel={t("oversight.openPlan", {
        time: formatDateTime(plan.createdAt, i18n.language),
      })}
      style={({ pressed }) => [
        styles.planRow,
        {
          minHeight: theme.metrics.minTouchTarget,
          borderRadius: theme.metrics.radius,
          borderWidth: theme.metrics.borderWidth,
          // Darkens rather than thickening: a border that changes width reflows the row and
          // nudges everything below it by a pixel on every press.
          borderColor:
            pressed || highlighted ? theme.colors.borderStrong : theme.colors.border,
        },
      ]}
    >
      <View style={styles.planPills}>
        <RecommendationStatusPill
          status={plan.status}
          decision={plan.approval?.decision ?? null}
        />

        {/*
          Supervisors sit on the trailing edge, opposite the status: the status is about the
          plan and this is about who answers for it, so keeping them apart stops the row
          reading as one run-on label.

          ENTITY pills (ADR-0017 §4) — they name identities, so they take the neutral fill and
          never a semantic colour. A person's name must not render in hazard red because of the
          status sitting beside it.

          Shown on every plan whatever its status, which is the point: accountability for a
          site does not appear only once somebody has decided. But it is the SITE's supervisor,
          not the plan's author — nothing records who drafted a recommendation, and most are
          drafted by the scheduler with no human involved. The label says so.
        */}
        <View style={styles.planOwners}>
          {supervisors.map((supervisor) => (
            <Pill
              key={supervisor.id}
              role="entity"
              // Just the name. "Site supervisor:" doubled the pill's width and pushed it onto a
              // second line, and a name sitting opposite a status pill already reads as "who
              // owns this" — the prefix was spending a whole row to say what position says.
              label={supervisor.displayName}
              // The long form survives here, because read aloud in isolation a bare name is
              // only a name.
              accessibilityLabel={t("oversight.supervisorLabel", {
                name: supervisor.displayName,
              })}
            />
          ))}

          {/*
            The decider, only when it is not one of the site's supervisors. Where it is — the
            usual case — the pill above already carries the name, and repeating it would put
            the same person on the row twice. Kept for the case that is genuinely new
            information: an admin, or a supervisor since moved off the site, decided this.
          */}
          {deciderName && !supervisors.some((s) => s.displayName === deciderName) ? (
            <Pill role="entity" label={deciderName} />
          ) : null}
        </View>
      </View>

      {/* The chevron that used to sit here is gone: the border now carries the affordance,
          and a row with both read as busier than it needed to be. */}
      <AppText variant="caption" tone="secondary" style={styles.planMeta}>
        {t("recommendations.draftedAt", {
          time: formatDateTime(plan.createdAt, i18n.language),
        })}
      </AppText>
    </Pressable>
  );
}

/** The expandable contents of one site: its plans, or why there are none to show. */
function SitePlanList({
  plans,
  workerNameFor,
  supervisors,
  onOpenPlan,
}: Readonly<{
  plans: SitePlans | undefined;
  workerNameFor: (id: string) => string | null;
  /** The site's supervisors, passed down so every plan row carries them. */
  supervisors: SiteSupervisor[];
  onOpenPlan: (plan: Recommendation) => void;
}>) {
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
          supervisors={supervisors}
          onPress={() => onOpenPlan(plan)}
          /*
           * The server's name first, then the worker list, then nothing — never the id.
           *
           * That last step is the fix. `approverId` was falling through to the badge as a raw
           * UUID on every decided plan, because the only lookup available returns WORKERs and
           * an approver is a SUPERVISOR, so the id could never resolve. It read as gibberish
           * and, being 36 characters with no spaces, could not wrap either.
           *
           * The worker lookup is kept for the case it does cover: a plan decided before the
           * server carried `approverName`, by someone who happens to be in the loaded list.
           */
          deciderName={
            plan.approval
              ? (plan.approval.approverName ?? workerNameFor(plan.approval.approverId))
              : null
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
  const navigation = useNavigation<NativeStackNavigationProp<OversightStackParamList>>();

  const user = useAppSelector((state) => state.auth.user);
  const { sites, status, errorKey, refreshing, plansBySite, summaryBySite } = useAppSelector(
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
      // One request covering every site. This is what lets a collapsed row say what is waiting
      // on it, instead of reporting zero until someone opens it.
      void dispatch(loadPlanSummary());

      /*
       * Expanded rows refresh too, and this was missing.
       *
       * Plans were fetched once on first expand and then kept forever — "collapsing a row is a
       * display change, not a reason to discard work", which is true and was the wrong
       * conclusion. A decision is made by somebody else, on another device: a supervisor
       * approves a plan and the manager watching this screen kept seeing "Awaiting decision"
       * with no way to correct it, because refresh re-read the site list and the counts but
       * never the plans themselves, and re-expanding a cached site deliberately does not
       * refetch. There was no in-app path to the truth at all.
       *
       * Collapsed sites are left alone — the summary already reports what is outstanding on
       * them, at one request for all twenty rather than one per site.
       */
      expanded.forEach((siteId) => void dispatch(loadSitePlans({ siteId })));
    },
    [dispatch, siteIds, expanded],
  );

  /*
   * Refreshes on focus, on resume from background, and on a timer — the same treatment the
   * supervisor's Plans tab gets, and for a stronger reason. This screen's whole job is showing
   * a manager what is waiting on a decision, so it is the one screen where being wrong about
   * that is the failure rather than a staleness annoyance.
   *
   * PLANS_MS is matched to the server's own auto-draft interval; see REFRESH_INTERVALS.
   */
  useAutoRefresh(
    useCallback(() => load(false), [load]),
    REFRESH_INTERVALS.PLANS_MS,
  );

  const workerNameFor = useCallback(
    (workerId: string) => workers.find((w) => w.id === workerId)?.displayName ?? null,
    [workers],
  );

  const toggleSite = useCallback(
    (siteId: string) => {
      /*
       * The dispatch sits outside the updater, and that matters.
       *
       * It used to live inside `setExpanded`'s callback, which React is free to invoke during
       * render and more than once — so this logged "Cannot update a component while rendering a
       * different component" and could fire the fetch twice for one tap. An updater must be a
       * pure function of the previous state; side effects belong out here.
       */
      const willExpand = !expanded.has(siteId);

      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(siteId)) {
          next.delete(siteId);
        } else {
          next.add(siteId);
        }
        return next;
      });

      // Fetched once, on first expand. Re-expanding a site already loaded is instant, because
      // collapsing a row is a display change and not a reason to discard work — and the auto
      // refresh keeps an expanded site current anyway.
      if (willExpand && !plansBySite[siteId]) void dispatch(loadSitePlans({ siteId }));
    },
    [dispatch, expanded, plansBySite],
  );

  /*
   * Ordered by what needs attention, not alphabetically.
   *
   * With twenty sites, alphabetical ordering means reading all twenty to find the one with a
   * decision outstanding. Sites with plans awaiting a decision rise; ties break by name so the
   * order does not shuffle between refreshes, which would move a row under a manager's thumb.
   *
   * The counts come from the server summary, so this is correct on arrival rather than
   * sharpening as rows are opened. That was the previous behaviour and it was the wrong
   * trade for a triage screen: a site nobody had expanded sorted as though it had nothing
   * outstanding, so the one site that needed attention could sit at the bottom of the list.
   */
  const ordered = useMemo(() => {
    return [...sites].sort((a, b) => {
      const byAwaiting =
        awaitingDecisionCount(plansBySite[b.id], summaryBySite[b.id]) -
        awaitingDecisionCount(plansBySite[a.id], summaryBySite[a.id]);
      return byAwaiting !== 0 ? byAwaiting : a.name.localeCompare(b.name);
    });
  }, [sites, plansBySite, summaryBySite]);

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
    const awaiting = awaitingDecisionCount(plans, summaryBySite[item.id]);

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
          <SitePlanList
            plans={plans}
            workerNameFor={workerNameFor}
            /* From the summary, so the pills are present on every plan the moment the site is
               expanded — the same one request that supplies the awaiting counts. */
            supervisors={summaryBySite[item.id]?.supervisors ?? []}
            /* siteId comes from the row rather than the plan: a Recommendation names only its
               shift, and the detail screen is site-scoped like every other plan endpoint. */
            onOpenPlan={(plan) =>
              navigation.navigate("RecommendationDetail", {
                siteId: item.id,
                shiftId: plan.shiftId,
                recommendationId: plan.id,
              })
            }
          />
        </Disclosure>
      </View>
    );
  };

  return (
    <AppSafeView>
      <FlatList
        testID="oversight-list"
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
    // Padding rather than the old paddingTop: the border needs to sit clear of the content it
    // encloses, or the pills touch it.
    padding: s(10),
    justifyContent: "center",
    gap: vs(6),
  },
  planPills: {
    flexDirection: "row",
    /*
     * No wrap: the status and the owner share one line, whatever the status.
     *
     * A long label used to push the owner pill onto a second row, which read as two unrelated
     * facts stacked rather than one row saying "this plan, this owner". With the prefix gone a
     * name fits comfortably, and the shrink below is what keeps it on the line when it does not
     * — the pill's own text wraps inside its border instead of the pill relocating.
     */
    flexWrap: "nowrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: s(6),
  },
  planOwners: {
    flexDirection: "row",
    // Wraps within the trailing group only, so a site with several supervisors stacks them on
    // the right rather than shunting the status pill around.
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    // Yields to the status pill rather than clipping it: at 1.5x text the name gets narrower
    // and wraps inside its own pill, and the status stays fully readable.
    flexShrink: 1,
    gap: s(6),
  },
  planMeta: {
    flexShrink: 1,
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
