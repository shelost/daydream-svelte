<script lang="js">
    import { loggedCalls, sessionTotalCost, clearSessionLogs } from '$lib/stores/apiLogStore.js';
    import AppTable from '$lib/components/AppTable.svelte';

    let formattedCost = '$0.00';
    let logs = [];

    sessionTotalCost.subscribe(value => {
        formattedCost = value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    });

    loggedCalls.subscribe(value => {
        logs = value;
    });

    function formatTimestamp(isoString) {
        if (!isoString) return 'N/A';
        try {
            const date = new Date(isoString);
            // Format like: 05.20.2025, 3:09 PM
            const dateStr = date.toLocaleDateString('en-US', {
                month: '2-digit',
                day: '2-digit',
                year: 'numeric'
            }).replace(/\//g, '.');

            const timeStr = date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });

            return `${dateStr}, <span class="time-value">${timeStr}</span>`;
        } catch (e) {
            return 'Invalid Date';
        }
    }

    function formatCost(cost) {
        if (typeof cost !== 'number') return 'N/A';
        return cost.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 });
    }

    function getStatusClass(status) {
        if (status >= 200 && status < 300) return 'status-success';
        if (status >= 400 && status < 500) return 'status-client-error';
        if (status >= 500) return 'status-server-error';
        return 'status-unknown';
    }

    function formatStatus(status) {
        if (status >= 200 && status < 300) return 'Success!';
        if (status >= 400 && status < 500) return 'Error';
        if (status >= 500) return 'Server Error';
        return status || 'N/A';
    }

    function getProviderLogo(provider) {
        if (!provider) return '';

        // Map provider names to their logo files
        const providerLogos = {
            'openai': '/openai.svg',
            'anthropic': '/anthropic.svg',
            'google': '/google.svg',
            // Add more providers as needed
        };

        // Default to the provider name in lowercase for the logo file
        const logoPath = providerLogos[provider.toLowerCase()] || `/${provider.toLowerCase()}.svg`;

        return `<img src="${logoPath}" alt="${provider}" class="provider-logo" onerror="this.style.display='none';" />${provider}`;
    }

    const apiLogColumns = [
        {
            key: 'timestamp',
            title: 'Timestamp',
            formatter: (value) => formatTimestamp(value)
        },
        {
            key: 'page',
            title: 'Page',
            formatter: (value) => value || 'Unknown'
        },
        {
            key: 'apiProvider',
            title: 'Provider',
            formatter: (value) => value ? getProviderLogo(value) : 'N/A'
        },
        {
            key: 'model',
            title: 'Model',
            formatter: (value, row) => {
                const modelText = value || 'N/A';
                const endpointText = row.endpoint ? ` (${row.endpoint})` : '';
                return `${modelText}`;
            }
        },
        {
            key: 'durationMs',
            title: 'Duration (ms)',
            formatter: (value) => (value !== undefined ? value : 'N/A')
        },
        {
            key: 'status',
            title: 'Status',
            formatter: (value) => formatStatus(value),
            cellClass: (value) => getStatusClass(value)
        },
        {
            key: 'cost',
            title: 'Cost/Tokens',
            formatter: (value, row) => {
                if (typeof value === 'number' && value > 0) {
                    return formatCost(value);
                } else if (row.inputTokens || row.outputTokens) {
                    const input = row.inputTokens || 0;
                    const output = row.outputTokens || 0;
                    return `${input + output} tokens (${input} in, ${output} out)`;
                } else {
                    return '—';
                }
            }
        },
        /*
        {
            key: 'error',
            title: 'Error',
            formatter: (value) => value || '-',
            cellClass: () => 'error-cell-content'
        }
            */
    ];

</script>

<div id='main'>

    <div class = 'flex'>

        <div class = 'mast'>
            <div class="header">
                <h1> Profile </h1>
            </div>
            <div class="summary">
                <h2>Current Session API Cost</h2>
                <p class="total-cost">{formattedCost}</p>
                <button on:click={clearSessionLogs} class="clear-log-button">Clear Session Log & Cost</button>
            </div>
        </div>

        <div class="table">
            <AppTable data={logs} columns={apiLogColumns} maxLinesPerPage={20} />
        </div>
    </div>


</div>

<style lang="scss">
    #main {
        width: 100%;
        height: 100%;

        overflow-y: hidden;
        box-sizing: border-box;
        font-family: 'Inter', sans-serif;
        color: #e0e0e0;
    }

    .flex{
        display: flex;
        gap: 24px;
        height: 100%;


        .table {
            padding: 40px 60px 40px 60px;
            height: 100%;
            flex: 1;
            overflow-x: visible;
            overflow-y: scroll;
            h2 {
                font-size: 18px;
                margin-bottom: 15px;
                color: #b0b0b0;
            }
        }
    }

    .header {
        margin-bottom: 30px;
        h1 {
            font-family: "ivypresto-headline", serif;
            font-size: 36px;
            font-weight: 500;
            color: white;
            letter-spacing: 0px;
            text-align: center;
        }
    }

    .mast{
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        padding: 40px 0px 40px 60px;
    }

    .summary{
        background-color: rgba(255, 255, 255, 0.05);
        padding: 20px;
        border-radius: 8px;
        margin-bottom: 30px;
        text-align: center;
        border: 1px solid rgba(255, 255, 255, 0.1);

        h2 {
            font-family: "ivypresto-headline", serif;
            font-size: 24px;
            font-weight: 500;
            letter-spacing: 0px;
            margin-top: 0;
            margin-bottom: 10px;
            color: #b0b0b0;
        }

        .total-cost {
            font-family: "ivypresto-headline", serif;
            font-size: 36px;
            font-weight: 500;
            color: white;
            margin-bottom: 20px;
        }

        .clear-log-button {
            background-color: #f44336;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            display: none;
            transition: background-color 0.3s ease;

            &:hover {
                background-color: #d32f2f;
            }
        }
    }


</style>