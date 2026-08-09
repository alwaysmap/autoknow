'use client';

import { useState } from 'react';
import Link from 'next/link';
import DataTable from '../../../components/DataTable';
import DateCell from '../../../components/DateCell';
import PhaseHillChart from '../../../components/PhaseHillChart';
import { NeedleGaugeSvg } from '../../../components/NeedleGaugeSvg';
import MemberStatusDot from '../../../components/MemberStatusDot';
import Combobox from '../../../components/Combobox';
import { toComboboxOptions } from '../../../lib/comboboxOptions';
import { initiativeProjectHref, partnerHref, programHref } from '../../../lib/entityHref';
import type { InitiativeMemberRow } from '../../../lib/initiativeQueries';
import { t, type Locale } from '../../../lib/i18n';
import styles from './page.module.css';

// The initiative's partners as the shared DataTable (owner call 2026-08-08): needle
// gauge in one column, the copy's little hill in another — the same instruments the
// partner page's program rows and the program page carry, so one partner's reading
// looks identical wherever it appears. A CLIENT component because DataTable takes
// `renderRow` (the house reason).

/** The Devices column (autoknow-hcz.14): the member's linked real head-unit programs
 *  as links, each with its unlink, plus an add affordance that reveals a Combobox over
 *  the partner's own real programs (canonical rows — AGENTS lesson 3; the action
 *  re-checks same-partner + real-program at the boundary). A component of its own
 *  because the reveal is row-local state, which `renderRow` cannot hold. */
function DevicesCell({
  initiativeId,
  member,
  locale,
  linkAction,
  unlinkAction,
}: {
  initiativeId: number;
  member: InitiativeMemberRow;
  locale: Locale;
  linkAction: (formData: FormData) => Promise<void>;
  unlinkAction: (formData: FormData) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  // No linked devices AND nothing left to offer = the partner has no real,
  // unarchived programs at all (a linked one would still show above).
  const noRealPrograms = member.devices.length === 0 && member.linkablePrograms.length === 0;
  return (
    <td>
      {member.devices.map((d) => (
        <span key={d.deviceId} className={styles.deviceItem}>
          <Link href={programHref(d.projectId)}>{d.name}</Link>
          <form action={unlinkAction} className={styles.removeForm}>
            <input type="hidden" name="deviceId" value={d.deviceId} />
            <button
              type="submit"
              className={styles.deviceUnlinkBtn}
              aria-label={t(locale, 'initiativeUnlinkDeviceAria', { p: d.name })}
            >
              ×
            </button>
          </form>
        </span>
      ))}
      {/* Nothing to link: a muted em dash rather than a picker over an empty list. */}
      {noRealPrograms && <span className={styles.mutedCell}>—</span>}
      {member.linkablePrograms.length > 0 &&
        (adding ? (
          <form action={linkAction} className={styles.deviceAddForm}>
            <input type="hidden" name="initiativeId" value={initiativeId} />
            <input type="hidden" name="partnerId" value={member.partnerId} />
            <Combobox
              // Remount when the option set changes: after a link lands, the row
              // re-renders with the picked program gone from the options, and a
              // surviving instance would keep showing the committed text of a choice
              // that no longer exists. A fresh instance rests empty, ready for the next.
              key={member.linkablePrograms.map((p) => p.id).join('-')}
              id={`link-device-${member.partnerId}`}
              name="projectId"
              options={toComboboxOptions(member.linkablePrograms)}
              emptyLabel={t(locale, 'selectProgram')}
              required
              autoFocus
              className={styles.devicePicker}
              aria-label={t(locale, 'initiativeLinkDeviceAria', { p: member.partnerName })}
            />
            <button type="submit" className={styles.deviceLinkBtn}>
              {t(locale, 'initiativeLinkDeviceButton')}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className={styles.deviceAddBtn}
            onClick={() => setAdding(true)}
            aria-label={t(locale, 'initiativeLinkDeviceAria', { p: member.partnerName })}
          >
            {t(locale, 'initiativeAddDevice')}
          </button>
        ))}
    </td>
  );
}

export default function InitiativeMembersTable({
  initiativeId,
  members,
  locale,
  removeAction,
  linkAction,
  unlinkAction,
}: {
  initiativeId: number;
  members: InitiativeMemberRow[];
  locale: Locale;
  removeAction: (formData: FormData) => Promise<void>;
  linkAction: (formData: FormData) => Promise<void>;
  unlinkAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <DataTable
      headers={[
        { key: 'partnerName', label: t(locale, 'initiativeColPartners'), sortable: true },
        { key: 'theNeedle', label: t(locale, 'initiativeColHealth') },
        { key: 'phases', label: t(locale, 'phasesCard') },
        { key: 'completion', label: t(locale, 'initiativeColProgress'), sortable: true, sortType: 'number' },
        { key: 'targetDate', label: t(locale, 'initiativeTargetLabel'), sortable: true, sortType: 'date' },
        { key: 'devices', label: t(locale, 'initiativeColDevices') },
        { key: 'remove', label: '' },
      ]}
      data={members}
      defaultSortKey="partnerName"
      defaultSortOrder="asc"
      paginate={false}
      emptyStateMessage={t(locale, 'initiativeNoMembers')}
      renderRow={(m: InitiativeMemberRow) => {
        return (
          <tr key={m.partnerId}>
            <td>
              <div className={styles.memberWho}>
                <Link href={m.projectId ? initiativeProjectHref(initiativeId, m.projectId) : partnerHref(m.partnerId)}>
                  {m.partnerName}
                </Link>
                <small>
                  <Link href={partnerHref(m.partnerId)} className={styles.regionLink}>{m.regionName}</Link>
                </small>
              </div>
            </td>
            <td>
              <span className={styles.gaugeCell}>
                <NeedleGaugeSvg progress={m.completion} health={m.theNeedle} />
              </span>
            </td>
            <td>
              {m.phases.length > 0 ? (
                <span className={styles.hillCell}>
                  <PhaseHillChart phases={m.phases} />
                </span>
              ) : (
                <span className={styles.mutedCell}>—</span>
              )}
            </td>
            <td>
              <span className={styles.pct}>{m.completion}%</span>{' '}
              <MemberStatusDot status={m.status} locale={locale} />
            </td>
            <td><DateCell value={m.targetDate} /></td>
            <DevicesCell
              initiativeId={initiativeId}
              member={m}
              locale={locale}
              linkAction={linkAction}
              unlinkAction={unlinkAction}
            />
            <td>
              <form action={removeAction} className={styles.removeForm}>
                <input type="hidden" name="initiativeId" value={initiativeId} />
                <input type="hidden" name="partnerId" value={m.partnerId} />
                <button type="submit" className={styles.removeBtn}>
                  {t(locale, 'removeFromInitiative')}
                </button>
              </form>
            </td>
          </tr>
        );
      }}
    />
  );
}
