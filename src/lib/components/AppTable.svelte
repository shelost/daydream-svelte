<script lang="js">
// File: src/lib/components/AppTable.svelte
import { createEventDispatcher } from 'svelte';

export let data = [];
export let columns = []; // Expected format: [{ key: 'dataKey', title: 'Column Title', formatter: (value, row) => formattedValue, cellClass: (value, row) => 'css-class' }, ...]
export let maxLinesPerPage = 25;

let currentPage = 1;

$: totalPages = Math.max(1, Math.ceil(data.length / maxLinesPerPage));
$: paginatedData = data.slice((currentPage - 1) * maxLinesPerPage, currentPage * maxLinesPerPage);

function nextPage() {
    if (currentPage < totalPages) {
        currentPage++;
    }
}

function prevPage() {
    if (currentPage > 1) {
        currentPage--;
    }
}

function getCellValue(row, column) {
    const value = row[column.key];
    if (column.formatter) {
        return column.formatter(value, row);
    }
    return value !== undefined && value !== null ? value : 'N/A';
}

function getCellClass(row, column) {
    if (column.cellClass) {
        const value = row[column.key];
        return column.cellClass(value, row);
    }
    return '';
}

const dispatch = createEventDispatcher();

function handleRowClick(row) {
    dispatch('rowClick', row);
}

</script>

<div class="app-table-container">
    {#if data.length > 0}
        <table>
            <thead>
                <tr>
                    {#each columns as column}
                        <th>{column.title}</th>
                    {/each}
                </tr>
            </thead>
            <tbody>
                {#each paginatedData as row (row.id || JSON.stringify(row))}
                    <tr on:click={() => handleRowClick(row)}>
                        {#each columns as column}
                            <td class={getCellClass(row, column)}>
                                {@html getCellValue(row, column)}
                            </td>
                        {/each}
                    </tr>
                {/each}
            </tbody>
        </table>

        {#if totalPages > 1}
            <div class="pagination-controls">
                <button on:click={prevPage} disabled={currentPage === 1}>Previous</button>
                <span>Page {currentPage} of {totalPages}</span>
                <button on:click={nextPage} disabled={currentPage === totalPages}>Next</button>
            </div>
        {/if}
    {:else}
        <p class="no-data-message">No data to display.</p>
    {/if}
</div>

<style lang="scss">
    .app-table-container {
        width: 100%;
        font-family: 'Inter', sans-serif; // Match profile page
        color: #e0e0e0; // Match profile page
    }

    table {
        width: 100%;
        border-collapse: collapse;
        background-color: rgba(black, 0.6); // Match profile page table
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.08); // Match profile page table
        box-shadow: -15px 30px 50px rgba(0, 0, 0, 0.3); // Match profile page table
        margin-bottom: 15px; // Add some space before pagination

        tr{
            cursor: pointer;
            transition: .2s ease;
            &:hover{
                background: rgba(white, 0.03);
            }
        }


        th, td {
            padding: 13px 15px;
            text-align: left;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08); // Match profile page table
            font-size: 13px; // Match profile page table
            font-weight: 400; // Match profile page table
            letter-spacing: -.25px; // Match profile page table

        }

        :global(.provider-logo){
            background: white;
            padding: 2px;
            height: 20px !important;
            border-radius: 4px;
        }


        th {
            background-color: rgba(0, 0, 0, 0.07); // Match profile page table
            color: #c0c0c0; // Match profile page table
            font-weight: 600; // Match profile page table
        }

        tr:last-child td {
            border-bottom: none; // Match profile page table
        }

        // Classes for status, can be more generic or passed via cellClass
        .status-success {
            color: #66bb6a;
        }
        .status-client-error {
            color: #ffa726;
        }
        .status-server-error {
            color: #ef5350;
        }
        .status-unknown {
            color: #78909c;
        }
        .error-cell-content { // Renamed to avoid conflict if AppTable is used elsewhere
            max-width: 250px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-style: italic;
            color: #ffcc80;
        }

        // New styles for provider logos and time values
        :global(.provider-logo) {
            height: 16px;
            width: auto;
            margin-right: 8px;
            vertical-align: middle;
            opacity: 0.9;
        }

        :global(.time-value) {
            color: #a5a5a5;
            font-style: italic;
        }
    }

    .pagination-controls {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 10px 0;
        font-size: 14px;

        button {
            background-color: rgba(255, 255, 255, 0.1);
            color: #e0e0e0;
            border: 1px solid rgba(255, 255, 255, 0.2);
            padding: 8px 15px;
            border-radius: 5px;
            cursor: pointer;
            margin: 0 10px;
            transition: background-color 0.3s ease;

            &:hover:not(:disabled) {
                background-color: rgba(255, 255, 255, 0.2);
            }

            &:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        }

        span {
            color: #b0b0b0;
        }
    }

    .no-data-message {
        font-size: 14px; // Match profile page "no api calls" message
        text-align: center;
        color: #888; // Match profile page "no api calls" message
        margin-top: 20px;
    }
</style>