/**
 * Workers reporting that they are struggling (US-11).
 *
 * ── WHY THIS IS A TAB AND NOT A SECTION ─────────────────────────────────────────────────
 * A hydration timestamp is routine; a concern is somebody saying they feel unwell in the heat.
 * Putting it behind "open the right shift, scroll past the crew" makes it something you find
 * after the fact. It sits in the tab bar with a count on it so the supervisor does not have to go
 * looking.
 *
 * ── OPEN FIRST, AND ACKNOWLEDGED STAYS VISIBLE ──────────────────────────────────────────
 * The slice sorts unseen concerns to the top. Handled ones remain on the list rather than
 * disappearing — "did anyone deal with the dizziness at 11:20" is a question asked hours later,
 * and a list that empties itself cannot answer it.
 *
 * @author Justin Chua
 */
import { useCallback, useEffect } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppLoader from "@/components/feedback/AppLoader";
import MessageBanner from "@/components/feedback/MessageBanner";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { acknowledgeConcern, loadConcerns } from "@/store/reducers/wellbeingSlice";
import { loadShifts } from "@/store/reducers/shiftsSlice";
import { formatDateTime } from "@/helpers/dateTime";
import { sharedPaddingHorizontal, cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";

export default function ConcernsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();

  const user = useAppSelector((state) => state.auth.user);
  const { concerns, status, refreshing, errorKey, acknowledgingId } =
    useAppSelector((state) => state.wellbeing);
  const workers = useAppSelector((state) => state.shifts.workers);
  const selectedSiteId = useAppSelector((state) => state.shifts.selectedSiteId);

  const siteId = selectedSiteId ?? user?.siteIds[0] ?? null;

  const load = useCallback(
    (isRefresh: boolean) => {
      if (!siteId) return;
      // Workers too: a concern carries a worker id, and a supervisor needs a name.
      void dispatch(loadShifts({ siteIds: user?.siteIds ?? [], siteId, refreshing: isRefresh }));
      void dispatch(loadConcerns({ siteId, refreshing: isRefresh }));
    },
    [dispatch, siteId, user?.siteIds],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  /* `GET /workers` returns ACTIVE workers only, so a concern raised by someone since offboarded
     resolves to no name. Saying so beats showing a UUID, and matches the shift screens. */
  const workerNameFor = useCallback(
    (workerId: string) =>
      workers.find((worker) => worker.id === workerId)?.displayName ?? t("shifts.unknownWorker"),
    [workers, t],
  );

  const onAcknowledge = useCallback(
    async (concernId: string) => {
      if (!siteId) return;
      const result = await dispatch(acknowledgeConcern({ siteId, concernId }));

      if (acknowledgeConcern.rejected.match(result)) {
        const key = result.payload?.errorKey ?? "errors.unknown";
        /* A 409 means a colleague got there first — which is a fine outcome, not a failure worth
           a retry. Reloading makes the screen show who did, rather than inviting a second try. */
        const message = key === "errors.conflict" ? t("wellbeing.alreadyAcknowledged") : t(key);
        if (key === "errors.conflict") void dispatch(loadConcerns({ siteId }));
        Alert.alert(t("wellbeing.acknowledgeFailedTitle"), message, [{ text: t("common.close") }]);
      }
    },
    [dispatch, siteId, t],
  );

  if (status === "loading" && concerns.length === 0) {
    return (
      <AppSafeView>
        <AppLoader />
      </AppSafeView>
    );
  }

  return (
    <AppSafeView>
      <FlatList
        data={concerns}
        keyExtractor={(item) => item.id}
        extraData={`${i18n.language}|${theme.highContrast}|${theme.fontScale}|${acknowledgingId}|${workers.length}`}
        contentContainerStyle={[styles.content, concerns.length === 0 && styles.contentEmpty]}
        showsVerticalScrollIndicator={false}
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
            <View style={styles.block}>
              <MessageBanner message={t(errorKey)} tone="danger" />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <AppText variant="subtitle">{t("wellbeing.concernsEmptyTitle")}</AppText>
            <AppText variant="body" tone="secondary" style={styles.emptyBody}>
              {t("wellbeing.concernsEmptyBody")}
            </AppText>
          </View>
        }
        renderItem={({ item }) => {
          const open = item.status === "OPEN";
          return (
            <View
              style={[
                styles.card,
                cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
                {
                  borderRadius: theme.metrics.radius,
                  backgroundColor: theme.colors.surface,
                  // An unseen concern carries a danger edge. Once someone has looked at it the
                  // card recedes rather than continuing to shout at everybody who opens the tab.
                  borderColor: open ? theme.colors.danger : theme.colors.border,
                },
              ]}
            >
              <View style={styles.cardHeader}>
                <AppText variant="subtitle" style={styles.cardTitle}>
                  {workerNameFor(item.workerId)}
                </AppText>
                <AppText variant="caption" tone={open ? "danger" : "secondary"}>
                  {open ? t("wellbeing.concernOpen") : t("wellbeing.concernAcknowledged")}
                </AppText>
              </View>

              {/* The chips, translated. A worker tapped DIZZINESS in Tamil; this reads "Dizzy" in
                  the supervisor's language, because both render the same enum. */}
              {item.symptoms.length > 0 ? (
                <AppText variant="body" style={styles.symptoms}>
                  {item.symptoms.map((symptom) => t(`symptoms.${symptom}`)).join(" · ")}
                </AppText>
              ) : null}

              {item.note ? (
                <View style={styles.note}>
                  <AppText variant="caption" tone="secondary">
                    {t("wellbeing.noteFromWorker")}
                  </AppText>
                  <AppText variant="body">{item.note}</AppText>
                  {/* Said plainly rather than machine-translated: the app cannot translate a
                      worker's own words, and pretending otherwise would put words in their mouth
                      on a safety record. */}
                  <AppText variant="caption" tone="secondary" style={styles.noteHint}>
                    {t("wellbeing.untranslatedNote")}
                  </AppText>
                </View>
              ) : null}

              <AppText variant="caption" tone="secondary" style={styles.meta}>
                {t("wellbeing.raisedAt", { time: formatDateTime(item.raisedAt, i18n.language) })}
              </AppText>

              {item.acknowledgedAt ? (
                <AppText variant="caption" tone="secondary">
                  {t("wellbeing.acknowledgedAt", {
                    time: formatDateTime(item.acknowledgedAt, i18n.language),
                  })}
                </AppText>
              ) : (
                <AppButton
                  title={
                    acknowledgingId === item.id
                      ? t("wellbeing.acknowledging")
                      : t("wellbeing.acknowledgeButton")
                  }
                  loading={acknowledgingId === item.id}
                  onPress={() => void onAcknowledge(item.id)}
                  style={styles.action}
                />
              )}
            </View>
          );
        }}
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
    flexGrow: 1,
    justifyContent: "center",
  },
  block: {
    marginBottom: vs(12),
  },
  empty: {
    alignItems: "center",
    paddingHorizontal: sharedPaddingHorizontal,
  },
  emptyBody: {
    marginTop: vs(6),
    textAlign: "center",
  },
  card: {
    padding: s(14),
    marginBottom: vs(12),
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  cardTitle: {
    flex: 1,
    marginEnd: s(10),
  },
  symptoms: {
    marginTop: vs(8),
  },
  note: {
    marginTop: vs(10),
    gap: vs(2),
  },
  noteHint: {
    marginTop: vs(2),
  },
  meta: {
    marginTop: vs(10),
  },
  action: {
    marginTop: vs(10),
  },
});
