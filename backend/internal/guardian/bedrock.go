package guardian

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
)

// BedrockInvoker calls an Anthropic model on AWS Bedrock via the
// provider-agnostic Converse API. It implements ModelInvoker.
type BedrockInvoker struct {
	client  *bedrockruntime.Client
	modelID string
}

// NewBedrockInvoker builds a Bedrock-backed invoker using the standard AWS
// SDK credential chain (IRSA in-cluster, shared config locally). It
// returns an error rather than panicking so the caller can fail open to
// deterministic-only validation when Bedrock is not reachable/configured.
func NewBedrockInvoker(ctx context.Context, region, modelID string) (*BedrockInvoker, error) {
	if modelID == "" {
		return nil, fmt.Errorf("bedrock model id is required")
	}
	var optFns []func(*awsconfig.LoadOptions) error
	if region != "" {
		optFns = append(optFns, awsconfig.WithRegion(region))
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, optFns...)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config for bedrock: %w", err)
	}
	return &BedrockInvoker{
		client:  bedrockruntime.NewFromConfig(cfg),
		modelID: modelID,
	}, nil
}

// Invoke sends a single-turn system+user prompt and returns the
// concatenated text of the model's response.
func (b *BedrockInvoker) Invoke(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
	out, err := b.client.Converse(ctx, &bedrockruntime.ConverseInput{
		ModelId: aws.String(b.modelID),
		System: []types.SystemContentBlock{
			&types.SystemContentBlockMemberText{Value: systemPrompt},
		},
		Messages: []types.Message{
			{
				Role: types.ConversationRoleUser,
				Content: []types.ContentBlock{
					&types.ContentBlockMemberText{Value: userPrompt},
				},
			},
		},
		InferenceConfig: &types.InferenceConfiguration{
			MaxTokens:   aws.Int32(1024),
			Temperature: aws.Float32(0),
		},
	})
	if err != nil {
		return "", fmt.Errorf("bedrock converse failed: %w", err)
	}

	msgOut, ok := out.Output.(*types.ConverseOutputMemberMessage)
	if !ok {
		return "", fmt.Errorf("unexpected bedrock response shape")
	}

	var sb strings.Builder
	for _, block := range msgOut.Value.Content {
		if textBlock, ok := block.(*types.ContentBlockMemberText); ok {
			sb.WriteString(textBlock.Value)
		}
	}
	return sb.String(), nil
}
