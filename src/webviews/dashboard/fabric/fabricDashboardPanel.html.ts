export const fabricDashboardHtml = `
  <div class="p-6 max-w-screen-xl mx-auto">
    <header class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-2xl font-semibold mb-1 bg-gradient-to-r from-[var(--accent)] to-[var(--info)] bg-clip-text text-transparent">Fabric Network Dashboard</h1>
        <p class="text-sm text-[var(--text-secondary)]">Real-time monitoring and analytics for your network infrastructure</p>
      </div>
      <select id="namespaceSelect" class="bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded px-2 py-1"></select>
    </header>

    <div class="grid gap-5 mb-8 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
      <div class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 transition-all relative overflow-hidden hover:-translate-y-1 hover:shadow-lg hover:border-[var(--accent)]">
        <div class="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-2">Total Nodes</div>
        <div class="text-2xl font-bold mb-1" id="nodes-total">0</div>
      </div>

      <div class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 transition-all relative overflow-hidden hover:-translate-y-1 hover:shadow-lg hover:border-[var(--accent)]">
        <div class="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-2">Synced Nodes</div>
        <div class="text-2xl font-bold mb-1" id="nodes-synced">0</div>
      </div>

      <div class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 transition-all relative overflow-hidden hover:-translate-y-1 hover:shadow-lg hover:border-[var(--accent)]">
        <div class="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-2">Not Synced</div>
        <div class="text-2xl font-bold mb-1" id="nodes-unsynced">0</div>
      </div>
    </div>

    <div class="grid gap-5 mb-8 xl:[grid-template-columns:auto_1fr]">
      <div class="flex flex-col gap-5 w-[280px] sm:flex-row xl:flex-col xl:w-[280px] sm:w-full">
        <div class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 transition-all relative overflow-hidden hover:-translate-y-1 hover:shadow-lg hover:border-[var(--accent)]">
          <div class="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-2">Total Interfaces</div>
          <div class="text-2xl font-bold mb-1" id="if-total">0</div>
        </div>
        <div class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 transition-all relative overflow-hidden hover:-translate-y-1 hover:shadow-lg hover:border-[var(--accent)]">
          <div class="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-2">Up Interfaces</div>
          <div class="text-2xl font-bold mb-1" id="if-up">0</div>
        </div>
        <div class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 transition-all relative overflow-hidden hover:-translate-y-1 hover:shadow-lg hover:border-[var(--accent)]">
          <div class="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-2">Down Interfaces</div>
          <div class="text-2xl font-bold mb-1" id="if-down">0</div>
        </div>
      </div>

      <div class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 transition-all hover:border-[var(--accent)] hover:shadow-md flex-1">
        <div class="text-lg font-semibold mb-4 flex items-center justify-between">
          <span>Traffic Rate</span>
        </div>
        <div id="traffic-chart" class="h-[300px]"></div>
      </div>
    </div>

    <div class="grid gap-5 mb-8 [grid-template-columns:repeat(5,1fr)]" id="fabric-stats">
      <div class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 transition-all relative overflow-hidden hover:-translate-y-1 hover:shadow-lg hover:border-[var(--accent)]">
        <div class="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-2">Fabric Health</div>
        <div class="flex items-center gap-2">
          <div class="text-2xl font-bold mb-1" id="fabric-health">0%</div>
          <div class="status-indicator" id="fabric-health-indicator"></div>
        </div>
      </div>
      <div class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 transition-all relative overflow-hidden hover:-translate-y-1 hover:shadow-lg hover:border-[var(--accent)]">
        <div class="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-2">Spines</div>
        <div class="flex items-center gap-2">
          <div class="text-2xl font-bold mb-1" id="fabric-spines">0</div>
          <div class="status-indicator" id="fabric-spines-health"></div>
        </div>
      </div>
      <div class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 transition-all relative overflow-hidden hover:-translate-y-1 hover:shadow-lg hover:border-[var(--accent)]">
        <div class="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-2">Leafs</div>
        <div class="flex items-center gap-2">
          <div class="text-2xl font-bold mb-1" id="fabric-leafs">0</div>
          <div class="status-indicator" id="fabric-leafs-health"></div>
        </div>
      </div>
      <div class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 transition-all relative overflow-hidden hover:-translate-y-1 hover:shadow-lg hover:border-[var(--accent)]">
        <div class="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-2">Borderleafs</div>
        <div class="flex items-center gap-2">
          <div class="text-2xl font-bold mb-1" id="fabric-borderleafs">0</div>
          <div class="status-indicator" id="fabric-borderleafs-health"></div>
        </div>
      </div>
      <div class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 transition-all relative overflow-hidden hover:-translate-y-1 hover:shadow-lg hover:border-[var(--accent)]">
        <div class="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-2">Superspines</div>
        <div class="flex items-center gap-2">
          <div class="text-2xl font-bold mb-1" id="fabric-superspines">0</div>
          <div class="status-indicator" id="fabric-superspines-health"></div>
        </div>
      </div>
    </div>

  </div>
`;