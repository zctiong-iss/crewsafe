/**
 * The approved-action inbox (SCRUM-186).
 *
 * ── WHAT IS ON SCREEN IS NOT WHAT THE SERVER RETURNS ────────────────────────────────────
 * `GET /api/action-dispatch/worker/{id}/pending` returns PENDING rows only, so an action
 * disappears from the server's answer the moment it is acknowledged. The list rendered here
 * is the union of that answer and this device's own acknowledgement records — which is the
 * only way to satisfy "clear acknowledged / pending states" against a PENDING-only query.
 *
 * A FlatList rather than a mapped ScrollView: this is server-driven data of unbounded
 * length, which is exactly the case virtualisation exists for. (The demo-user picker and
 * the scenario switchers are `.map`, correctly — three compile-time fixtures each.)
 */
import { useCallback, useMemo } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppLoader from "@/components/feedback/AppLoader";
import MessageBanner from "@/components/feedback/MessageBanner";
import AppSwitch from "@/components/inputs/AppSwitch";
import DispatchCard from "@/components/inbox/DispatchCard";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { acknowledge, loadInbox, resetAcknowledgements } from "@/store/reducers/dispatchInboxSlice";
import { useAutoRefresh, REFRESH_INTERVALS } from "@/hooks/useAutoRefresh";
import { isMockApi } from "@/auth/authMode";
import {
  acknowledgementCount,
  getSimulateLostResponse,
  resetMockDispatches,
  setSimulateLostResponse,
} from "@/api/mock/dispatch";
import { sharedPaddingHorizontal } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";
import type { ActionDispatch } from "@/types/domain";

export default function InboxScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();

  const user = useAppSelector((state) => state.auth.user);
  const { status, pending, acknowledged, inFlight, failures, errorKey, requestId, refreshing } =
    useAppSelector((state) => state.dispatchInbox);

  const load = useCallback(
    (isRefresh: boolean) => {
      if (!user) return;
      void dispatch(loadInbox({ workerId: user.id, refreshing: isRefresh }));
    },
    [dispatch, user],
  );

  // The NFR is "visible to an online worker within 60 seconds"; polling at half that
  // leaves room for a slow round trip and still meets it.
  useAutoRefresh(
    useCallback(() => load(false), [load]),
    REFRESH_INTERVALS.INBOX_MS,
  );

  /*
   * Pending from the server, plus everything this device has acknowledged, newest first.
   *
   * De-duplicated by id because the two sources can briefly overlap: a refetch that started
   * before an acknowledgement landed will still carry the row as PENDING.
   */
  const items = useMemo(() => {
    const byId = new Map<string, ActionDispatch>();
    for (const item of pending) byId.set(item.id, item);
    for (const record of Object.values(acknowledged)) {
      byId.set(record.dispatch.id, record.dispatch);
    }
    return [...byId.values()].sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt));
  }, [pending, acknowledged]);

  if (status === "loading") {
    return (
      <AppSafeView>
        <AppLoader fullscreen message={t("common.loading")} />
      </AppSafeView>
    );
  }

  const header =
    status === "error" ? (
      <View style={styles.block}>
        <MessageBanner
          message={t(errorKey ?? "errors.unknown")}
          tone="danger"
          requestId={requestId}
        />
        <AppButton title={t("common.retry")} onPress={() => load(false)} style={styles.retry} />
      </View>
    ) : null;

  const empty =
    status === "ready" ? (
      <View style={styles.empty}>
        <AppText variant="title" style={styles.centre}>
          {t("inbox.emptyTitle")}
        </AppText>
        <AppText variant="body" tone="secondary" style={[styles.centre, styles.emptyBody]}>
          {t("inbox.emptyBody")}
        </AppText>
      </View>
    ) : null;

  /*
   * The dev panel is where SCRUM-186's acceptance criterion becomes checkable by hand.
   *
   * "Killing the network mid-acknowledgement and retrying produces exactly one
   * acknowledgement server-side" is not observable from the UI alone — success and
   * duplicate-success look identical. The count is read straight from the mock server's
   * ledger, so it is the server's own answer rather than the client's belief about it.
   */
  const footer =
    __DEV__ && isMockApi() ? (
      <View
        style={[
          styles.devPanel,
          { borderTopColor: theme.colors.border, borderTopWidth: theme.metrics.borderWidth },
        ]}
      >
        <AppSwitch
          label={t("dev.lostResponseLabel")}
          hint={t("dev.lostResponseHint")}
          value={getSimulateLostResponse()}
          onValueChange={(value) => {
            setSimulateLostResponse(value);
            // Re-render so the switch reflects the module-level flag it just changed.
            load(true);
          }}
        />

        {items.map((item) => (
          <AppText key={item.id} variant="caption" tone="secondary" style={styles.ackCount}>
            {`${t(`actions.${item.actionCode}`, { defaultValue: item.actionCode })} — ${t(
              "dev.serverAckCount",
              { total: acknowledgementCount(item.id) },
            )}`}
          </AppText>
        ))}

        <AppButton
          title={t("dev.resetInbox")}
          variant="secondary"
          style={styles.retry}
          onPress={() => {
            resetMockDispatches();
            dispatch(resetAcknowledgements());
            load(true);
          }}
        />
      </View>
    ) : null;

  return (
    <AppSafeView>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        /*
         * `items` is memoised on `pending` and `acknowledged`, so those two update rows on
         * their own. `inFlight` and `failures` are not in it — without listing them here a
         * card would not show its spinner when an acknowledgement starts, nor its error
         * when one fails, because FlatList is a PureComponent and `data` did not change.
         * Language and theme are here for the same reason.
         */
        extraData={`${i18n.language}|${theme.highContrast}|${theme.fontScale}|${inFlight.join(",")}|${Object.keys(failures).join(",")}`}
        contentContainerStyle={[styles.content, items.length === 0 && styles.contentEmpty]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
        renderItem={({ item }) => (
          <DispatchCard
            dispatch={item}
            acknowledgedAt={acknowledged[item.id]?.acknowledgedAt ?? null}
            inFlight={inFlight.includes(item.id)}
            failureKey={failures[item.id] ?? null}
            onAcknowledge={() => void dispatch(acknowledge({ dispatchId: item.id }))}
            locale={i18n.language}
          />
        )}
      />
    </AppSafeView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: sharedPaddingHorizontal,
    paddingVertical: vs(12),
  },
  contentEmpty: {
    // Only when empty: flexGrow on a populated list stretches the last card.
    flexGrow: 1,
  },
  block: {
    marginBottom: vs(12),
  },
  retry: {
    marginTop: vs(12),
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: vs(48),
  },
  centre: {
    textAlign: "center",
  },
  emptyBody: {
    marginTop: vs(8),
  },
  devPanel: {
    marginTop: vs(28),
    paddingTop: vs(12),
  },
  ackCount: {
    marginTop: vs(6),
  },
});
