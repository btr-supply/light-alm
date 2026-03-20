<script lang="ts">
  import { app } from "../lib/stores.svelte";
  import { fmtTime, fmtUsd, shortAddr, fmtGasCost, chainName } from "@btr-supply/shared/format";
</script>

<div class="overflow-auto">
  {#if app.txlog.length === 0}
    <div class="text-center py-3 text-2xs text-zinc-600">No transactions</div>
  {:else}
    <table class="tbl">
      <thead>
        <tr>
          <th class="th">Time</th>
          <th class="th">Decision</th>
          <th class="th">Op</th>
          <th class="th">Pool</th>
          <th class="th">Chain</th>
          <th class="th">Tokens</th>
          <th class="th text-right">Amount</th>
          <th class="th text-right">Gas</th>
          <th class="th">Status</th>
          <th class="th">TxHash</th>
        </tr>
      </thead>
      <tbody>
        {#each app.txlog as tx}
          <tr class="tr">
            <td class="td">{fmtTime(tx.ts)}</td>
            <td class="td">
              <span class="decision-badge" data-decision={tx.decisionType}>{tx.decisionType}</span>
            </td>
            <td class="td">{tx.opType}</td>
            <td class="td">{shortAddr(tx.pool, 6, 0)}</td>
            <td class="td">{chainName(tx.chain)}</td>
            <td class="td text-zinc-600">
              {shortAddr(tx.inputToken, 4, 0)} &rarr; {shortAddr(tx.outputToken, 4, 0)}
            </td>
            <td class="td text-right">
              {tx.inputUsd > 0 ? fmtUsd(tx.inputUsd) : "-"} &rarr; {tx.outputUsd > 0 ? fmtUsd(tx.outputUsd) : "-"}
            </td>
            <td class="td text-right">{fmtGasCost(tx.gasUsed, tx.gasPrice)}</td>
            <td class="td">
              <span class={tx.status === "success" ? "text-positive" : "text-negative"}>
                {tx.status === "success" ? "\u2713" : "\u2717"}
              </span>
            </td>
            <td class="td">
              {#if tx.txHash}
                <span class="text-zinc-600 cursor-pointer hover:text-zinc-300" title={tx.txHash}>{shortAddr(tx.txHash, 6, 4)}</span>
              {:else}
                <span class="text-zinc-600">-</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
