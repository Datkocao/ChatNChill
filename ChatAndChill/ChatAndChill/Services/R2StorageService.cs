using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;
using System.Net;

namespace ChatAndChill.Services;

// Gói mọi thao tác với Cloudflare R2: tải lên, xoá, tạo link tải có hạn
public class R2StorageService
{
    private readonly IAmazonS3 _s3;
    private readonly string _bucket;

    public R2StorageService(IOptions<R2Options> options)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.AccountId) || string.IsNullOrWhiteSpace(o.AccessKeyId)
            || string.IsNullOrWhiteSpace(o.SecretAccessKey) || string.IsNullOrWhiteSpace(o.Bucket))
            throw new InvalidOperationException("Thiếu cấu hình R2 trong User Secrets (R2:AccountId, AccessKeyId, SecretAccessKey, Bucket).");

        var config = new AmazonS3Config
        {
            ServiceURL = $"https://{o.AccountId}.r2.cloudflarestorage.com",
            ForcePathStyle = true,
            AuthenticationRegion = "auto",
            RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
            ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED
        };

        _s3 = new AmazonS3Client(new BasicAWSCredentials(o.AccessKeyId, o.SecretAccessKey), config);
        _bucket = o.Bucket;
    }

    // Kiểm tra kết nối: liệt kê tối đa 1 file
    public async Task<bool> PingAsync()
    {
        var res = await _s3.ListObjectsV2Async(new ListObjectsV2Request { BucketName = _bucket, MaxKeys = 1 });
        return res.HttpStatusCode == System.Net.HttpStatusCode.OK;
    }

    public async Task UploadAsync(string key, Stream stream, string contentType, CancellationToken ct = default)
    {
        await _s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = _bucket,
            Key = key,
            InputStream = stream,
            ContentType = contentType,
            DisablePayloadSigning = true
        }, ct);
    }

    // Tải file về để server trả cho trình duyệt; không có file thì trả null
    public async Task<(Stream Stream, string ContentType)?> DownloadAsync(string key, CancellationToken ct = default)
    {
        try
        {
            var res = await _s3.GetObjectAsync(_bucket, key, ct);
            return (res.ResponseStream, res.Headers.ContentType);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    // Xoá file; lỗi xoá không làm hỏng thao tác chính
    public async Task DeleteAsync(IEnumerable<string> keys)
    {
        foreach (var key in keys.Distinct())
        {
            try { await _s3.DeleteObjectAsync(_bucket, key); }
            catch { /* bỏ qua */ }
        }
    }

    // Link tải có hạn (mặc định 30 phút). inline = true cho ảnh, false thì ép tải về
    public string GetDownloadUrl(string key, string? fileName = null, bool inline = true, TimeSpan? lifetime = null)
    {
        var req = new GetPreSignedUrlRequest
        {
            BucketName = _bucket,
            Key = key,
            Verb = HttpVerb.GET,
            Expires = DateTime.UtcNow.Add(lifetime ?? TimeSpan.FromMinutes(30))
        };

        if (!inline && !string.IsNullOrEmpty(fileName))
            req.ResponseHeaderOverrides.ContentDisposition =
                $"attachment; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";

        return _s3.GetPreSignedURL(req);
    }
}