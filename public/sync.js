// Sync queue management for offline operations
const SyncManager = {
  db: null,

  async init(db) {
    this.db = db;
  },

  async add(operation) {
    if (!this.db) throw new Error('DB not initialized');

    await this.db.syncQueue.add({
      action: operation.endpoint,
      endpoint: operation.endpoint,
      method: operation.method,
      data: operation.data,
      timestamp: Date.now(),
      synced: false
    });

    console.log('Operation queued:', operation.endpoint, 'Total pending:', await this.db.syncQueue.count());

    // Try to sync if online
    if (navigator.onLine) {
      this.sync();
    }
  },

  async sync() {
    if (!navigator.onLine) {
      console.log('Sync skipped: offline');
      return;
    }

    const operations = await this.db.syncQueue.toArray();
    if (operations.length === 0) {
      console.log('Sync skipped: queue empty');
      return;
    }

    console.log('Sync starting:', operations.length, 'operations');

    const token = localStorage.getItem('token');
    if (!token) {
      console.log('Sync skipped: no token');
      return;
    }

    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ operations })
      });

      console.log('Sync response status:', response.status);

      if (response.ok) {
        const result = await response.json();
        console.log('Sync completed:', result);
        
        // Update local records with server IDs
        if (result.idMapping) {
          for (const [localId, serverId] of Object.entries(result.idMapping)) {
            console.log('Updating local ID', localId, 'to server ID', serverId);
            // Update heaters table
            const heater = await this.db.heaters.get(localId);
            if (heater) {
              await this.db.heaters.delete(localId);
              await this.db.heaters.put({ ...heater, id: serverId });
            }
          }
        }
        
        await this.db.syncQueue.clear();
        console.log('Sync queue cleared');
        
        // Refresh data after sync
        if (typeof loadData === 'function') {
          loadData();
        }
      } else {
        const errorText = await response.text();
        console.error('Sync failed with status:', response.status, errorText);
      }
    } catch (err) {
      console.error('Sync failed with error:', err);
    }
  },

  async getPendingCount() {
    if (!this.db) return 0;
    return await this.db.syncQueue.count();
  }
};

// Auto-sync on online event
window.addEventListener('online', () => {
  console.log('Online event - triggering sync');
  SyncManager.sync();
});

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SyncManager;
}
