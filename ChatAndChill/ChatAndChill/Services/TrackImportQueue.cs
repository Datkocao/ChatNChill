using System.Threading.Channels;

namespace ChatAndChill.Services;

// Hàng đợi các lần nhập nhạc chờ xử lý (chỉ chứa id; dữ liệu nằm trong bảng TrackImports)
public class TrackImportQueue
{
    private readonly Channel<int> _channel =
        Channel.CreateUnbounded<int>(new UnboundedChannelOptions { SingleReader = true });

    public void Enqueue(int importId) => _channel.Writer.TryWrite(importId);

    public IAsyncEnumerable<int> ReadAllAsync(CancellationToken ct) =>
        _channel.Reader.ReadAllAsync(ct);
}